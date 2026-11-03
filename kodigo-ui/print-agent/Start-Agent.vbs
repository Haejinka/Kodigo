Option Explicit
Dim shell, fileSystem, agentPath
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
agentPath = fileSystem.GetParentFolderName(WScript.ScriptFullName) & "\Kodigo.PrintAgent.exe"
shell.Run Chr(34) & agentPath & Chr(34), 0, False
