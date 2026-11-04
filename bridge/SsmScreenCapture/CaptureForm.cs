using System.Drawing.Imaging;
using System.Text.Json;
using ScreenCapture.Core;

namespace SsmScreenCapture;

internal sealed class CaptureForm : Form
{
    private readonly string output;
    private readonly TextBox camera = new() { Width = 140, MaxLength = 100 };
    private readonly Button choose = new() { Text = "영상 영역 선택", AutoSize = true };
    private readonly Button start = new() { Text = "수집 시작", AutoSize = true, Enabled = false };
    private readonly Button stop = new() { Text = "수집 중지", AutoSize = true, Enabled = false };
    private readonly Button reset = new() { Text = "화면 변화 기준 새로 설정", AutoSize = true, Enabled = false };
    private readonly PictureBox preview = new() { Dock = DockStyle.Fill, SizeMode = PictureBoxSizeMode.Zoom, BackColor = Color.Black };
    private readonly Label status = new() { Dock = DockStyle.Fill, AutoSize = false, Text = "SSM에서 한 카메라를 크게 표시한 뒤 영상 영역을 선택하세요." };
    private readonly CheckBox verified = new() { Text = "캡처 미리보기가 SSM 라이브 영상과 일치함 확인", AutoSize = true };
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 1000 };
    private readonly ChangeDetector detector = new();
    private WindowSelection? selection;
    private FrameSink? sink;
    private CaptureState? state;
    private DateTimeOffset? startedAt;

    public CaptureForm(string output)
    {
        this.output = output; Text = "SSM 읽기 전용 화면 수집 · 방향 계산 미구현";
        Width = 880; Height = 640; MinimumSize = new(620, 420); StartPosition = FormStartPosition.CenterScreen;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 5, ColumnCount = 1, Padding = new(12) };
        layout.RowStyles.Add(new(SizeType.Absolute, 72)); layout.RowStyles.Add(new(SizeType.Absolute, 80));
        layout.RowStyles.Add(new(SizeType.Percent, 100)); layout.RowStyles.Add(new(SizeType.Absolute, 72));
        layout.RowStyles.Add(new(SizeType.Absolute, 32));
        layout.Controls.Add(new Label { Dock = DockStyle.Fill, Text = "카메라 제어 없이 선택한 영상 영역을 1초마다 읽습니다.\n최신 JPEG 2개만 로컬 교환 폴더에 보관하고 가림·중지 시 지웁니다. SSM 영상과 도구 창을 겹치지 않게 배치하세요.\n다른 카메라로 전환하거나 화면 배치를 바꾸면 중지 후 영역과 이름을 다시 지정하세요." }, 0, 0);
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill };
        buttons.Controls.AddRange([new Label { Text = "카메라 이름", AutoSize = true, Padding = new(0, 7, 0, 0) }, camera, choose, start, stop, reset]);
        layout.Controls.Add(buttons, 0, 1); layout.Controls.Add(preview, 0, 2); layout.Controls.Add(status, 0, 3); layout.Controls.Add(verified, 0, 4); Controls.Add(layout);
        choose.Click += (_, _) => SelectRegion(); start.Click += (_, _) => StartCapture(); stop.Click += (_, _) => StopCapture();
        reset.Click += (_, _) => { detector.Reset(); status.Text = "다음 화면으로 변화 기준을 새로 설정합니다. 방향 보정은 아닙니다."; };
        timer.Tick += (_, _) => TickCapture();
        FormClosing += (_, _) => StopCapture();
    }

    private void SelectRegion()
    {
        StopCapture(); Hide();
        try
        {
            using var picker = new RegionPicker();
            if (picker.ShowDialog() != DialogResult.OK) return;
            selection = NativeWindows.Select(picker.ScreenRegion);
            status.Text = $"선택: {selection.RelativeRegion.Width}×{selection.RelativeRegion.Height} · 카메라 이름을 입력하고 수집 시작을 누르세요.";
            start.Enabled = true;
        }
        catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            selection = null; start.Enabled = false; status.Text = e.Message;
        }
        finally { Show(); }
    }

    private void StartCapture()
    {
        var label = camera.Text.Trim();
        if (selection is null || label.Length is < 1 or > 100 || label.Any(char.IsControl))
        { status.Text = "카메라 이름과 영상 영역을 확인하세요."; return; }
        try
        {
            sink = new FrameSink(output); detector.Reset();
            startedAt = DateTimeOffset.UtcNow; verified.Checked = false;
            state = new CaptureState { SessionId = Guid.NewGuid().ToString("N"), CameraLabel = label,
                Status = "paused", ReasonCode = "not-started", UpdatedAt = DateTimeOffset.UtcNow };
            sink.Publish(state); camera.Enabled = choose.Enabled = start.Enabled = false;
            stop.Enabled = reset.Enabled = true; timer.Start(); TickCapture();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        { sink?.Dispose(); sink = null; status.Text = "로컬 교환 폴더를 사용할 수 없습니다. 다른 수집 도구가 실행 중인지 확인하세요. " + e.Message; }
    }

    private void TickCapture()
    {
        if (selection is null || state is null || sink is null) return;
        try
        {
            if (!NativeWindows.CanCapture(selection, out var region, out var reason)) { Pause(reason); return; }
            using var bitmap = ScreenPixels.Read(region);
            if (!NativeWindows.CanCapture(selection, out var after, out reason) || after != region) { Pause(reason); return; }
            var sample = new byte[80 * 45];
            for (var y = 0; y < 45; y++) for (var x = 0; x < 80; x++)
            {
                var pixel = bitmap.GetPixel((x * bitmap.Width + bitmap.Width / 2) / 80, (y * bitmap.Height + bitmap.Height / 2) / 45);
                sample[y * 80 + x] = (byte)((299 * pixel.R + 587 * pixel.G + 114 * pixel.B) / 1000);
            }
            var observation = detector.Observe(sample);
            using var memory = new MemoryStream();
            var encoder = ImageCodecInfo.GetImageEncoders().Single(e => e.FormatID == ImageFormat.Jpeg.Guid);
            using var parameters = new EncoderParameters(1);
            parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 80L);
            bitmap.Save(memory, encoder, parameters);
            var now = DateTimeOffset.UtcNow; var next = state.Sequence + 1;
            var published = state with { Status = "live", ReasonCode = "capturing", UpdatedAt = now, CapturedAt = now,
                Sequence = next, Width = bitmap.Width, Height = bitmap.Height,
                FrameFile = CaptureState.FrameName(state.SessionId, next), MeanDifference = observation.PreviousDifference,
                ReferenceDifference = observation.ReferenceDifference, SceneChanged = observation.SceneChanged, LowContrast = observation.LowContrast };
            sink.Publish(published, memory.ToArray()); state = published; ReplacePreview(new Bitmap(bitmap));
            status.Text = $"화면 수집 {now.ToLocalTime():yyyy-MM-dd HH:mm:ss} · {next}장 · 방향 UNKNOWN\n" +
                (observation.SceneChanged ? "화면 변화 감지 · 회전/줌 여부와 새 방향은 아직 계산하지 않습니다. " : "화면 변화 기준과 비교 중 · 방향 계산은 미구현입니다. ") +
                (observation.LowContrast ? "검은 화면/저대비 가능: 실제 SSM 영상과 캡처 결과를 확인하세요." : "");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception or ArgumentException or System.Runtime.InteropServices.ExternalException)
        {
            timer.Stop();
            try { Pause("capture-error"); }
            catch (Exception failure) when (failure is IOException or UnauthorizedAccessException) { ReplacePreview(null); }
            status.Text = NativeWindows.Message("capture-error") + " " + e.Message;
        }
    }

    private void Pause(string reason)
    {
        if (state is null || sink is null) return;
        state = state with { Status = "paused", ReasonCode = reason, UpdatedAt = DateTimeOffset.UtcNow, FrameFile = null };
        sink.Publish(state); ReplacePreview(null); status.Text = NativeWindows.Message(reason) + " · 방향 UNKNOWN";
    }

    private void StopCapture()
    {
        timer.Stop();
        try
        {
            if (state is not null && sink is not null)
            {
                sink.Publish(state with { Status = "stopped", ReasonCode = "user-stopped", UpdatedAt = DateTimeOffset.UtcNow, FrameFile = null });
                File.WriteAllText(Path.Combine(output, "screen-capture-report.private.json"), JsonSerializer.Serialize(new
                {
                    schemaVersion = 1, phase = "read-only-screen-capture", state.SessionId, state.CameraLabel,
                    startedAt, stoppedAt = DateTimeOffset.UtcNow, framesCaptured = state.Sequence,
                    operatorConfirmedVisualMatch = verified.Checked, state.SceneChanged, state.LowContrast,
                    directionStatus = "unknown", automaticDirectionTrackingImplemented = false,
                    captureTimestampSource = "local-pc-clock", underlyingStreamFreshnessVerified = false,
                    cameraControlRequests = 0, containsImages = false
                }, CaptureState.JsonOptions));
                status.Text = "수집을 중지하고 이미지를 지웠습니다. 시험 결과: data/capture.private/screen-capture-report.private.json";
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { status.Text = "중지 상태 저장 실패: " + e.Message; }
        finally
        {
            sink?.Dispose(); sink = null; state = null; detector.Reset(); ReplacePreview(null);
            camera.Enabled = choose.Enabled = true; start.Enabled = selection is not null; stop.Enabled = reset.Enabled = false;
        }
    }

    private void ReplacePreview(Image? image) { var old = preview.Image; preview.Image = image; old?.Dispose(); }
}
