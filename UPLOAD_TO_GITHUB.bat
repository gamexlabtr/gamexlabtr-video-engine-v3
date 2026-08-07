@echo off
echo GamexlabTR Video Studio GitHub yukleme yardimcisi
echo.
set /p REPOURL=GitHub repo URL'sini girin (ornek: https://github.com/kullanici/repo.git):
powershell -ExecutionPolicy Bypass -File "%~dp0UPLOAD_TO_GITHUB.ps1" -RepoUrl "%REPOURL%"
pause
