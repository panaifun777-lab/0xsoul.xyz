@echo off
chcp 65001 >nul
title GANG.SOUL 量化做市守护引擎 (Quant Engine)
echo ========================================================
echo 🤖 正在启动 GANG.SOUL 多智能体量化做市守护集群...
echo ========================================================
cd /d "%~dp0"
node "%~dp0node_modules\tsx\dist\cli.mjs" "%~dp0src\quant_runner.ts"
pause
