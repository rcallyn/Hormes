using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace Hormes.Windows.UI;

/// <summary>The notification-area icon (the Mac's menu-bar item): five white bars on black, and a small menu.</summary>
public sealed class TrayIcon : IDisposable
{
    private readonly NotifyIcon icon;
    private readonly ToolStripMenuItem clapItem;
    private readonly ToolStripMenuItem speakItem;
    private bool syncing;

    /// <summary>Show switches changed elsewhere (the Console's Settings) without acting on them again.</summary>
    public void SetChecks(bool clap, bool speak)
    {
        syncing = true;
        clapItem.Checked = clap;
        speakItem.Checked = speak;
        syncing = false;
    }

    public TrayIcon(Action openConsole, Action restartDaemon, Action openLog, Action quit, bool clap, Action<bool> setClap, bool speak, Action<bool> setSpeak)
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open Console", null, (_, _) => openConsole());
        // The microphone stays open while this is on (Windows shows its mic indicator); claps are detected on this PC.
        clapItem = new ToolStripMenuItem("Listen for double clap") { Checked = clap, CheckOnClick = true };
        clapItem.CheckedChanged += (_, _) => { if (!syncing) setClap(clapItem.Checked); };
        menu.Items.Add(clapItem);
        speakItem = new ToolStripMenuItem("Speak replies (ElevenLabs)") { Checked = speak, CheckOnClick = true };
        speakItem.CheckedChanged += (_, _) => { if (!syncing) setSpeak(speakItem.Checked); };
        menu.Items.Add(speakItem);
        menu.Items.Add("Restart daemon", null, (_, _) => restartDaemon());
        menu.Items.Add("Open daemon log", null, (_, _) => openLog());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit Hormes", null, (_, _) => quit());
        icon = new NotifyIcon
        {
            Icon = Draw(),
            Text = "Hormes",
            ContextMenuStrip = menu,
            Visible = true,
        };
        icon.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) openConsole(); };
    }

    /// <summary>A Windows notification from the tray (an automation's banner).</summary>
    public void Notify(string title, string? body) =>
        icon.ShowBalloonTip(8000, title.Length > 63 ? title[..63] : title, string.IsNullOrEmpty(body) ? " " : body, ToolTipIcon.None);

    /// <summary>Tooltip text; Windows caps it at 127 characters.</summary>
    public string Status
    {
        set => icon.Text = ("Hormes · " + value) is var s && s.Length > 127 ? s[..127] : s;
    }

    /// <summary>The mark, drawn: five white bars on a black rounded square.</summary>
    public static Icon Draw(int size = 32)
    {
        using var bmp = new Bitmap(size, size);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using var bg = RoundedRect(new RectangleF(0, 0, size, size), size * 0.22f);
            g.FillPath(Brushes.Black, bg);
            float[] shape = { 0.32f, 0.55f, 0.75f, 0.55f, 0.32f };
            var bar = size * 0.09f;
            var gap = size * 0.06f;
            var x = (size - (5 * bar + 4 * gap)) / 2;
            foreach (var s in shape)
            {
                var h = size * s;
                using var path = RoundedRect(new RectangleF(x, (size - h) / 2, bar, h), bar / 2);
                g.FillPath(Brushes.White, path);
                x += bar + gap;
            }
        }
        return Icon.FromHandle(bmp.GetHicon());
    }

    private static GraphicsPath RoundedRect(RectangleF r, float radius)
    {
        var d = radius * 2;
        var path = new GraphicsPath();
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    public void Dispose()
    {
        icon.Visible = false;
        icon.Dispose();
    }
}
