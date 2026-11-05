@echo off
cd /d "%~dp0"
if not exist client\dist\index.html call npm run build
start "" http://127.0.0.1:4000
call npm start
