# Mudrik Todo List

## UI/UX Improvements
- [x] Restore top 5 recent chats
- [ ] Guide intro for new installer users (first-run onboarding)
- [ ] Mudrik hide to system tray (top-notch / mac menu bar style)
- [ ] Owl pointer: normal logo PNG when thinking/waiting, pointing owl PNG only during guide steps

## Security Features
- [ ] **Sensitive Data Detection in UIA Context**
  - **Pre-send scan**: Before sending UIA-gathered context to AI, scan for sensitive data types:
    - Password fields (input type="password", masked fields)
    - Credit card numbers (patterns like 4xxx-xxxx-xxxx-xxxx)
    - API keys / tokens (patterns like sk-xxx, Bearer xxx)
    - Social Security Numbers / National IDs
    - Email addresses in sensitive contexts
    - Bank account numbers
  - **User alert**: Display a prominent warning banner at top of chat container:
    - List detected sensitive data types found in context
    - Require explicit user acknowledgment (checkbox: "I understand and accept responsibility for sending this data")
    - Provide "Cancel & Hide" button to abort send and go back to hide sensitive elements
    - Provide "Proceed Anyway" button (only enabled after checkbox checked)
  - **Post-send AI monitoring**: After AI response, scan for AI explicitly asking for sensitive data:
    - Detect phrases like "please provide your password", "enter your credit card", "share your API key"
    - Alert user immediately: "The AI is asking for sensitive information. Do NOT share passwords, credit cards, or personal data."
  - **Implementation notes**:
    - Add detection logic in `context-reader.ts` or `ipc-handlers.ts` before `sendMessage`
    - Create new IPC channel for sensitive data alerts
    - Add UI banner component in `App.tsx` above chat messages
    - Make detection patterns configurable (regex list in config)
    - Log all sensitive data alerts for audit trail

## Completed
- [x] v1.1.0 UI overhaul (redesign branch merged)
