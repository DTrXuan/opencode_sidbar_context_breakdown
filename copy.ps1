$src = "D:\AI\opencode\selft_plugin_project\opencode_sidbar_context_breakdown\src\index.tsx"
$dst = "C:\Users\Admin\.config\opencode\node_modules\opencode-sidbar-context-breakdown\src\index.tsx"
$content = [System.IO.File]::ReadAllText($src)
[System.IO.File]::WriteAllText($dst, $content)