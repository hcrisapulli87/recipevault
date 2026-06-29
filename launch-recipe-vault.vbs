' RecipeVault launcher — always runs the LATEST code.
' Rebuilds from source (fast electron-vite build, ~2-3s) then runs it via electron-vite
' preview, so changes show up on every launch without manually repackaging the .exe.
' Window style 0 = the build/console is hidden; the app window appears once the build finishes.
' Written for THIS project; path is absolute and verified, not copied from another app.
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "C:\Users\Harrison Crisapulli\Documents\claudecode\recipe-vault"
shell.Run "cmd /c npm run app", 0, False
