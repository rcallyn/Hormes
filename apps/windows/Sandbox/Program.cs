// hormes-sandbox: run one program inside an AppContainer with no capabilities (so no network,
// no loopback) and file access only where an ACE for the container's SID was added here.
//
//   hormes-sandbox --workspace <dir> --scratch <dir> [--read-only] [--write-file <path>]...
//                  [--read <dir>]... -- <program> <args...>
//
// Any setup failure prints "hormes-sandbox: <reason>" to stderr and exits 126 with nothing run.
// The ACEs are removed again on exit (best effort; a hard kill of this process leaks them, see
// the README). The child lives in a kill-on-close Job object, so ending this process ends the tree.
using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;

namespace Hormes.Sandbox;

internal sealed class SetupException(string message) : Exception(message);

internal sealed class Options
{
    public string Workspace = "";
    public string Scratch = "";
    public bool ReadOnly;
    public List<string> WriteFiles = new();
    public List<string> ReadDirs = new();
    public List<string> Command = new();

    public static Options Parse(string[] args)
    {
        var o = new Options();
        int i = 0;
        string Next(string flag)
        {
            if (i + 1 >= args.Length) throw new SetupException($"{flag} needs a value");
            return args[++i];
        }
        for (; i < args.Length; i++)
        {
            string a = args[i];
            if (a == "--") { i++; break; }
            switch (a)
            {
                case "--workspace": o.Workspace = Next(a); break;
                case "--scratch": o.Scratch = Next(a); break;
                case "--read-only": o.ReadOnly = true; break;
                case "--write-file": o.WriteFiles.Add(Next(a)); break;
                case "--read": o.ReadDirs.Add(Next(a)); break;
                default: throw new SetupException($"unknown option {a}");
            }
        }
        for (; i < args.Length; i++) o.Command.Add(args[i]);
        if (o.Workspace.Length == 0) throw new SetupException("--workspace is required");
        if (o.Scratch.Length == 0) throw new SetupException("--scratch is required");
        if (o.Command.Count == 0) throw new SetupException("no program after --");
        o.Workspace = Path.GetFullPath(o.Workspace);
        o.Scratch = Path.GetFullPath(o.Scratch);
        for (int k = 0; k < o.WriteFiles.Count; k++) o.WriteFiles[k] = Path.GetFullPath(o.WriteFiles[k]);
        for (int k = 0; k < o.ReadDirs.Count; k++) o.ReadDirs[k] = Path.GetFullPath(o.ReadDirs[k]);
        return o;
    }
}

/// <summary>One ACE for the container SID on one path. A named semaphore counts the live sandboxes holding
/// the same grant, so a finishing foreground command does not strip a running background job; the last
/// holder out removes it.</summary>
internal sealed class Grant
{
    const int Max = 100000;
    static readonly string LockName = @"Local\hormes-sandbox-acl-lock";
    readonly string path;
    readonly bool isDir;
    readonly FileSystemAccessRule rule;
    Semaphore? sem;
    bool held;

    public Grant(SecurityIdentifier sid, string path, FileSystemRights rights, bool isDir)
    {
        this.path = path;
        this.isDir = isDir;
        var inherit = isDir ? InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit : InheritanceFlags.None;
        rule = new FileSystemAccessRule(sid, rights, inherit, PropagationFlags.None, AccessControlType.Allow);
        Key = $"{path.ToLowerInvariant()}|{(int)rights}";
    }

    public string Key { get; }

    static Mutex Lock()
    {
        var m = new Mutex(false, LockName);
        try { m.WaitOne(); } catch (AbandonedMutexException) { }
        return m;
    }

    string SemName()
    {
        var h = SHA1.HashData(Encoding.UTF8.GetBytes(Key));
        return @"Local\hormes-sandbox-" + Convert.ToHexString(h);
    }

    public void Acquire()
    {
        var m = Lock();
        try
        {
            sem = new Semaphore(Max, Max, SemName());
            sem.WaitOne(0);
            held = true;
            Apply(add: true);
        }
        catch (SetupException) { throw; }
        catch (Exception e) { throw new SetupException($"cannot grant access to {path}: {e.Message}"); }
        finally { m.ReleaseMutex(); m.Dispose(); }
    }

    void Apply(bool add)
    {
        if (isDir)
        {
            var info = new DirectoryInfo(path);
            var acl = info.GetAccessControl(AccessControlSections.Access);
            if (add) acl.AddAccessRule(rule); else acl.RemoveAccessRuleSpecific(rule);
            info.SetAccessControl(acl);
        }
        else
        {
            var info = new FileInfo(path);
            var acl = info.GetAccessControl(AccessControlSections.Access);
            if (add) acl.AddAccessRule(rule); else acl.RemoveAccessRuleSpecific(rule);
            info.SetAccessControl(acl);
        }
    }

    public void Release()
    {
        if (sem is null) return;
        Mutex? m = null;
        try
        {
            m = Lock();
            if (held)
            {
                held = false;
                int previous = sem.Release();
                if (previous == Max - 1) Apply(add: false);
            }
        }
        catch { /* best effort; a leaked ACE only helps processes inside the container, which only we start */ }
        finally
        {
            try { m?.ReleaseMutex(); } catch { }
            m?.Dispose();
            sem.Dispose();
            sem = null;
        }
    }
}

internal static class Program
{
    static IntPtr job;
    static readonly object jobGate = new();
    static NativeMethods.ConsoleCtrlHandler? ctrl;

    static int Main(string[] args)
    {
        try { return Run(args); }
        catch (SetupException e) { Console.Error.WriteLine("hormes-sandbox: " + e.Message); return 126; }
        catch (Exception e) { Console.Error.WriteLine("hormes-sandbox: " + e.Message); return 126; }
    }

    static void KillJob()
    {
        lock (jobGate) { if (job != IntPtr.Zero) NativeMethods.TerminateJobObject(job, 1); }
    }

    static int Run(string[] args)
    {
        if (!OperatingSystem.IsWindows()) throw new SetupException("Windows only");
        var o = Options.Parse(args);
        if (!Directory.Exists(o.Workspace)) throw new SetupException($"workspace does not exist: {o.Workspace}");
        if (!Directory.Exists(o.Scratch)) throw new SetupException($"scratch does not exist: {o.Scratch}");
        foreach (var d in o.ReadDirs) if (!Directory.Exists(d)) throw new SetupException($"--read folder does not exist: {d}");

        IntPtr sidPtr = EnsureProfile();
        var sid = new SecurityIdentifier(sidPtr);

        var grants = new List<Grant>
        {
            new(sid, o.Scratch, FileSystemRights.FullControl, true),
            new(sid, o.Workspace, o.ReadOnly ? FileSystemRights.ReadAndExecute | FileSystemRights.Synchronize : FileSystemRights.Modify | FileSystemRights.Synchronize, true),
        };
        foreach (var f in o.WriteFiles)
        {
            // The container cannot create a file in a read-only workspace, so the one fixed output exists up front.
            if (!File.Exists(f))
            {
                if (Directory.Exists(f)) throw new SetupException($"--write-file is a folder: {f}");
                using (File.Open(f, FileMode.CreateNew, FileAccess.Write)) { }
            }
            grants.Add(new(sid, f, FileSystemRights.Modify | FileSystemRights.Synchronize, false));
        }
        foreach (var d in o.ReadDirs) grants.Add(new(sid, d, FileSystemRights.ReadAndExecute | FileSystemRights.Synchronize, true));

        ctrl = _ => { KillJob(); return true; };
        NativeMethods.SetConsoleCtrlHandler(ctrl, true);
        AppDomain.CurrentDomain.ProcessExit += (_, _) => KillJob();

        var acquired = new List<Grant>();
        try
        {
            foreach (var g in grants) { g.Acquire(); acquired.Add(g); }
            return Launch(o, sidPtr);
        }
        finally
        {
            lock (jobGate) { if (job != IntPtr.Zero) { NativeMethods.CloseHandle(job); job = IntPtr.Zero; } }
            for (int i = acquired.Count - 1; i >= 0; i--) acquired[i].Release();
            // A grant that was being acquired when something threw is not in `acquired`; its Release is safe to call.
            foreach (var g in grants) if (!acquired.Contains(g)) g.Release();
        }
    }

    static IntPtr EnsureProfile()
    {
        const string name = "Hormes.Shell";
        int hr = NativeMethods.CreateAppContainerProfile(name, name, "Hormes shell sandbox", IntPtr.Zero, 0, out IntPtr sid);
        if (hr == 0) return sid;
        if (hr != unchecked((int)0x800700B7)) throw new SetupException($"cannot create the AppContainer profile (0x{hr:X8}): {new Win32Exception(hr & 0xFFFF).Message}");
        hr = NativeMethods.DeriveAppContainerSidFromAppContainerName(name, out sid);
        if (hr != 0) throw new SetupException($"cannot derive the AppContainer SID (0x{hr:X8})");
        return sid;
    }

    static string? Resolve(string program)
    {
        if (program.IndexOfAny(new[] { '\\', '/', ':' }) >= 0) return File.Exists(program) ? Path.GetFullPath(program) : null;
        var exts = (Environment.GetEnvironmentVariable("PATHEXT") ?? ".EXE").Split(';', StringSplitOptions.RemoveEmptyEntries);
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            string baseName;
            try { baseName = Path.Combine(dir.Trim('"'), program); } catch { continue; }
            if (Path.HasExtension(program) && File.Exists(baseName)) return baseName;
            foreach (var e in exts) if (File.Exists(baseName + e)) return baseName + e;
        }
        return null;
    }

    static void Quote(StringBuilder sb, string a)
    {
        if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) { sb.Append(a); return; }
        sb.Append('"');
        int bs = 0;
        foreach (char c in a)
        {
            if (c == '\\') bs++;
            else if (c == '"') { sb.Append('\\', bs * 2 + 1).Append('"'); bs = 0; }
            else { sb.Append('\\', bs).Append(c); bs = 0; }
        }
        sb.Append('\\', bs * 2).Append('"');
    }

    static IntPtr EnvironmentBlock()
    {
        var pairs = new List<string>();
        foreach (DictionaryEntry kv in Environment.GetEnvironmentVariables()) pairs.Add($"{kv.Key}={kv.Value}");
        pairs.Sort(StringComparer.OrdinalIgnoreCase);
        var sb = new StringBuilder();
        foreach (var p in pairs) sb.Append(p).Append('\0');
        sb.Append('\0');
        return Marshal.StringToHGlobalUni(sb.ToString());
    }

    static unsafe int Launch(Options o, IntPtr sidPtr)
    {
        string? exe = Resolve(o.Command[0]);
        if (exe is null) throw new SetupException($"program not found: {o.Command[0]}");

        var cmd = new StringBuilder();
        for (int i = 0; i < o.Command.Count; i++) { if (i > 0) cmd.Append(' '); Quote(cmd, i == 0 ? exe : o.Command[i]); }

        // Only our three standard handles are inherited.
        var std = new[] { NativeMethods.GetStdHandle(-10), NativeMethods.GetStdHandle(-11), NativeMethods.GetStdHandle(-12) };
        var inherited = new List<IntPtr>();
        for (int i = 0; i < 3; i++)
        {
            if (std[i] == IntPtr.Zero || std[i] == new IntPtr(-1)) { std[i] = IntPtr.Zero; continue; }
            NativeMethods.SetHandleInformation(std[i], 1, 1);
            if (!inherited.Contains(std[i])) inherited.Add(std[i]);
        }

        IntPtr scPtr = Marshal.AllocHGlobal(sizeof(NativeMethods.SECURITY_CAPABILITIES));
        IntPtr hlPtr = Marshal.AllocHGlobal(Math.Max(1, inherited.Count) * IntPtr.Size);
        IntPtr list = IntPtr.Zero, env = IntPtr.Zero;
        bool listInit = false;
        var pi = default(NativeMethods.PROCESS_INFORMATION);
        try
        {
            *(NativeMethods.SECURITY_CAPABILITIES*)scPtr = new NativeMethods.SECURITY_CAPABILITIES { AppContainerSid = sidPtr };
            for (int i = 0; i < inherited.Count; i++) ((IntPtr*)hlPtr)[i] = inherited[i];

            int attrs = inherited.Count > 0 ? 2 : 1;
            nuint size = 0;
            NativeMethods.InitializeProcThreadAttributeList(IntPtr.Zero, attrs, 0, ref size);
            list = Marshal.AllocHGlobal((nint)size);
            if (!NativeMethods.InitializeProcThreadAttributeList(list, attrs, 0, ref size)) throw Fail("InitializeProcThreadAttributeList");
            listInit = true;
            if (!NativeMethods.UpdateProcThreadAttribute(list, 0, new IntPtr(0x20009), scPtr, (nuint)sizeof(NativeMethods.SECURITY_CAPABILITIES), IntPtr.Zero, IntPtr.Zero)) throw Fail("UpdateProcThreadAttribute(security capabilities)");
            if (inherited.Count > 0 && !NativeMethods.UpdateProcThreadAttribute(list, 0, new IntPtr(0x20002), hlPtr, (nuint)(inherited.Count * IntPtr.Size), IntPtr.Zero, IntPtr.Zero)) throw Fail("UpdateProcThreadAttribute(handle list)");

            var si = new NativeMethods.STARTUPINFOEX();
            si.StartupInfo.cb = sizeof(NativeMethods.STARTUPINFOEX);
            si.StartupInfo.dwFlags = 0x100; // STARTF_USESTDHANDLES
            si.StartupInfo.hStdInput = std[0];
            si.StartupInfo.hStdOutput = std[1];
            si.StartupInfo.hStdError = std[2];
            si.lpAttributeList = list;
            env = EnvironmentBlock();

            IntPtr j = NativeMethods.CreateJobObjectW(IntPtr.Zero, null);
            if (j == IntPtr.Zero) throw Fail("CreateJobObject");
            var limits = new NativeMethods.JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if (!NativeMethods.SetInformationJobObject(j, 9, ref limits, (uint)sizeof(NativeMethods.JOBOBJECT_EXTENDED_LIMIT_INFORMATION))) { NativeMethods.CloseHandle(j); throw Fail("SetInformationJobObject"); }
            lock (jobGate) job = j;

            // EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED; stdio flows through the inherited handles.
            if (!NativeMethods.CreateProcessW(exe, cmd, IntPtr.Zero, IntPtr.Zero, true, 0x80000 | 0x400 | 0x4, env, o.Workspace, ref si, out pi)) throw Fail($"cannot start {Path.GetFileName(exe)} in the sandbox");
            if (!NativeMethods.AssignProcessToJobObject(j, pi.hProcess))
            {
                var err = Fail("AssignProcessToJobObject");
                NativeMethods.TerminateProcess(pi.hProcess, 1);
                throw err;
            }
            if (NativeMethods.ResumeThread(pi.hThread) == uint.MaxValue)
            {
                var err = Fail("ResumeThread");
                NativeMethods.TerminateProcess(pi.hProcess, 1);
                throw err;
            }
            NativeMethods.WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
            NativeMethods.GetExitCodeProcess(pi.hProcess, out uint code);
            KillJob(); // stragglers (a server the command left behind) end with the command
            return unchecked((int)code);
        }
        finally
        {
            if (pi.hThread != IntPtr.Zero) NativeMethods.CloseHandle(pi.hThread);
            if (pi.hProcess != IntPtr.Zero) NativeMethods.CloseHandle(pi.hProcess);
            if (listInit) NativeMethods.DeleteProcThreadAttributeList(list);
            if (list != IntPtr.Zero) Marshal.FreeHGlobal(list);
            if (env != IntPtr.Zero) Marshal.FreeHGlobal(env);
            Marshal.FreeHGlobal(scPtr);
            Marshal.FreeHGlobal(hlPtr);
        }
    }

    static SetupException Fail(string what) => new($"{what}: {new Win32Exception(Marshal.GetLastWin32Error()).Message}");
}

internal static class NativeMethods
{
    public delegate bool ConsoleCtrlHandler(uint ctrlType);

    [StructLayout(LayoutKind.Sequential)]
    public struct SECURITY_CAPABILITIES
    {
        public IntPtr AppContainerSid;
        public IntPtr Capabilities;
        public uint CapabilityCount;
        public uint Reserved;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO
    {
        public int cb;
        public IntPtr lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public uint dwProcessId, dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    public static extern int CreateAppContainerProfile(string pszAppContainerName, string pszDisplayName, string pszDescription, IntPtr pCapabilities, uint dwCapabilityCount, out IntPtr ppSidAppContainerSid);

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    public static extern int DeriveAppContainerSidFromAppContainerName(string pszAppContainerName, out IntPtr ppsidAppContainerSid);

    [DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int nStdHandle);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool InitializeProcThreadAttributeList(IntPtr lpAttributeList, int dwAttributeCount, int dwFlags, ref nuint lpSize);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool UpdateProcThreadAttribute(IntPtr lpAttributeList, uint dwFlags, IntPtr attribute, IntPtr lpValue, nuint cbSize, IntPtr lpPreviousValue, IntPtr lpReturnSize);
    [DllImport("kernel32.dll")] public static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcessW(string lpApplicationName, StringBuilder lpCommandLine, IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory, ref STARTUPINFOEX lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern IntPtr CreateJobObjectW(IntPtr lpJobAttributes, string? lpName);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint cb);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool TerminateJobObject(IntPtr hJob, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool TerminateProcess(IntPtr hProcess, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern uint ResumeThread(IntPtr hThread);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetExitCodeProcess(IntPtr h, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetConsoleCtrlHandler(ConsoleCtrlHandler handler, bool add);
}
