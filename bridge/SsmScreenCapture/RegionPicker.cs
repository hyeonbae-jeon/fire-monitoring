namespace SsmScreenCapture;

internal sealed class RegionPicker : Form
{
    private Point? start;
    private Rectangle selected;
    public Rectangle ScreenRegion { get; private set; }

    public RegionPicker()
    {
        FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.Manual;
        Bounds = SystemInformation.VirtualScreen; TopMost = true; ShowInTaskbar = false;
        BackColor = Color.Black; Opacity = .3; Cursor = Cursors.Cross; DoubleBuffered = true; KeyPreview = true;
        MouseDown += (_, e) => { if (e.Button == MouseButtons.Left) start = e.Location; };
        MouseMove += (_, e) =>
        {
            if (start is not { } origin) return;
            selected = Rectangle.FromLTRB(Math.Min(origin.X, e.X), Math.Min(origin.Y, e.Y), Math.Max(origin.X, e.X), Math.Max(origin.Y, e.Y));
            Invalidate();
        };
        MouseUp += (_, e) =>
        {
            if (e.Button != MouseButtons.Left || start is null) return;
            if (selected.Width < 64 || selected.Height < 64) { start = null; return; }
            ScreenRegion = new Rectangle(Left + selected.Left, Top + selected.Top, selected.Width, selected.Height);
            DialogResult = DialogResult.OK; Close();
        };
        KeyDown += (_, e) => { if (e.KeyCode == Keys.Escape) { DialogResult = DialogResult.Cancel; Close(); } };
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using var pen = new Pen(Color.Cyan, 5);
        e.Graphics.DrawRectangle(pen, selected);
        e.Graphics.DrawString("SSM의 단독 CCTV 영상 영역만 드래그하세요 · Esc 취소", Font, Brushes.White, 30, 30);
    }
}
