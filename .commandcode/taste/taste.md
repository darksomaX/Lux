# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# workflow
- Do not kill Node processes indiscriminately (e.g., killall node, taskkill on node.exe) - the assistant's own shell/process runs on Node, so killing all Node processes will terminate the assistant mid-operation. Use targeted port-based cleanup or process termination instead. When testing in agent-browser, target the specific browser window rather than killing browser/Node processes. Confidence: 0.90
- For QA verification, do not trust automated tests alone — use /agent-browser to manually verify functionality in the actual browser. Confidence: 0.70

# ui
See [ui/taste.md](ui/taste.md)

# scramjet
See [scramjet/taste.md](scramjet/taste.md)
