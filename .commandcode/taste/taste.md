# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# workflow
- Do not kill Node processes indiscriminately (e.g., killall node, taskkill on node.exe) - the assistant's own shell/process runs on Node, so killing all Node processes will terminate the assistant mid-operation. Use targeted port-based cleanup or process termination instead. Confidence: 0.85

# ui
- Applications/panels (notes, vault, games, settings) should load above the bottom taskbar, never covering it. The taskbar must always remain accessible. Confidence: 0.70
- Browser chrome tab bar includes back, forward, stop, reload, search bar, info button, plus/new-tab, and close buttons — not just a minimal tab strip. Confidence: 0.65
- Lux title text should have a fade-in-from-bottom entrance animation with a subtle floating/hovering effect. Confidence: 0.60

