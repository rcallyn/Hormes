using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Windows.Foundation;
using Windows.Security.Credentials.UI;
using static Hormes.Hands.Native;

namespace Hormes.Hands;

/// <summary>
/// `owner_approval`: Windows Hello (PIN, face or fingerprint) through UserConsentVerifier. The prompt names the pending action.
/// Never approves on anything but a verified owner: unavailable, cancelled, timed out and every error all read approved:false.
/// </summary>
internal static class Approval
{
    private const int WaitSeconds = 45;

    [ComImport, Guid("39E050C3-4E74-441A-8DC0-B81104DF949C"), InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
    private interface IUserConsentVerifierInterop
    {
        IntPtr RequestVerificationForWindowAsync(IntPtr appWindow, IntPtr message, [In] ref Guid riid);
    }

    [DllImport("combase.dll", PreserveSig = true)] private static extern int WindowsCreateString([MarshalAs(UnmanagedType.LPWStr)] string src, int len, out IntPtr hs);
    [DllImport("combase.dll", PreserveSig = true)] private static extern int WindowsDeleteString(IntPtr hs);
    [DllImport("combase.dll", PreserveSig = true)] private static extern int RoGetActivationFactory(IntPtr classId, [In] ref Guid iid, out IntPtr factory);

    public static Dictionary<string, object?> Op(Params p)
    {
        string id = p.RequireString("pendingId");
        string description = p.RequireString("description");
        if (id.Length == 0 || description.Length == 0) throw HandsException.BadRequest("missing approval target");
        bool approved = false;
        try { approved = Verify("Hormes asks to: " + (description.Length > 240 ? description[..240] : description)); }
        catch (Exception e) { Console.Error.WriteLine($"[hormes-hands] owner_approval: {e.Message}"); }
        return new Dictionary<string, object?> { ["pendingId"] = id, ["approved"] = approved };
    }

    private static bool Verify(string message)
    {
        var availability = UserConsentVerifier.CheckAvailabilityAsync().AsTask().GetAwaiter().GetResult();
        if (availability != UserConsentVerifierAvailability.Available) return false;
        UserConsentVerificationResult result;
        try { result = RequestForWindow(message); }
        catch (Exception e)
        {
            Console.Error.WriteLine($"[hormes-hands] window-bound prompt failed ({e.Message}); trying the plain prompt");
            var op = UserConsentVerifier.RequestVerificationAsync(message);
            var done = op.AsTask();
            if (!done.Wait(TimeSpan.FromSeconds(WaitSeconds))) { op.Cancel(); return false; }
            result = done.Result;
        }
        return result == UserConsentVerificationResult.Verified;
    }

    /// <summary>The prompt parented to a real window, so it comes to the front from a windowless helper (IUserConsentVerifierInterop).</summary>
    private static UserConsentVerificationResult RequestForWindow(string message)
    {
        var cls = "Windows.Security.Credentials.UI.UserConsentVerifier";
        Marshal.ThrowExceptionForHR(WindowsCreateString(cls, cls.Length, out var hsClass));
        try
        {
            var iid = typeof(IUserConsentVerifierInterop).GUID;
            Marshal.ThrowExceptionForHR(RoGetActivationFactory(hsClass, ref iid, out var factoryPtr));
            var interop = (IUserConsentVerifierInterop)Marshal.GetObjectForIUnknown(factoryPtr);
            Marshal.ThrowExceptionForHR(WindowsCreateString(message, message.Length, out var hsMsg));
            try
            {
                var hwnd = GetForegroundWindow();
                if (hwnd == IntPtr.Zero) hwnd = GetDesktopWindow();
                var riid = typeof(IAsyncOperation<UserConsentVerificationResult>).GUID;
                IntPtr opPtr = interop.RequestVerificationForWindowAsync(hwnd, hsMsg, ref riid);
                var op = WinRT.MarshalInterface<IAsyncOperation<UserConsentVerificationResult>>.FromAbi(opPtr);
                var task = op.AsTask();
                if (!task.Wait(TimeSpan.FromSeconds(WaitSeconds))) { op.Cancel(); return UserConsentVerificationResult.Canceled; }
                return task.Result;
            }
            finally { WindowsDeleteString(hsMsg); }
        }
        finally { WindowsDeleteString(hsClass); }
    }
}
