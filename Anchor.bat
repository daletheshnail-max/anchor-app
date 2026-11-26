@echo off
title Anchor - calm operating system
rem Serves the production build on a stable origin (127.0.0.1:5599) so
rem localStorage persists. Build first, from this folder:
rem   npm install
rem   npm run build
rem Fully offline after the build — localhost only.
start "Anchor server" /min python -m http.server 5599 --directory "%~dp0dist"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:5599/"
