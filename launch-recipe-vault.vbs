' RecipeVault launcher — starts the packaged app.
' Written for THIS project; paths are absolute and verified, not copied from another app.
Set shell = CreateObject("WScript.Shell")
shell.Run """C:\Users\Harrison Crisapulli\Documents\claudecode\recipe-vault\dist\win-unpacked\RecipeVault.exe""", 1, False
