@echo off
title Anchor - calm operating system
rem Serve on a STABLE local origin (127.0.0.1:5599) so your browser reliably
rem persists your data in localStorage. Fully offline - localhost only, no internet.
rem (file:// is unreliable for localStorage on some browsers, so we serve instead.)
start "Anchor server" /min python -m http.server 5599 --directory "C:\AI-Scripts\wellness-app"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:5599/"
