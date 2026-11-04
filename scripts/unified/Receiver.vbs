Option Explicit
Dim shell, fso, root, env, command, result
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
Set env = shell.Environment("Process")
env("CCTV_DATA_DIR") = root & "\data"
env("MAP_CONFIG_FILE") = root & "\data\map.demo.json"
shell.CurrentDirectory = root & "\app"
If Not fso.FileExists(root & "\data\server-settings.protected") Then WScript.Quit 1
command = Chr(34) & root & "\app\WisenetPtzBridge.exe" & Chr(34) & " --server --no-browser"
result = shell.Run(command, 0, True)
WScript.Quit result
