# Browser encrypted-sync security boundary

Browser sync encrypts workspace operations and media before they leave the device. Account keys stored in IndexedDB are non-extractable, which prevents normal raw-key export. This is not an isolation boundary against same-origin script execution: script running in the Neo Anki origin can invoke the stored key, read session/ciphertext state, or alter data before encryption.

Accordingly, browser sync is not recommended for high-sensitivity collections on origins that host unrelated scripts. Deploy the web client on a dedicated HTTPS origin with a strict CSP, no third-party scripts, reviewed dependency provenance, and prompt security updates. Disconnecting sync clears the browser sync record; deleting an account also clears it after the server confirms deletion. Clearing site data removes local key/session material and requires the recovery bundle to reconnect.

The desktop client provides the stronger local boundary: keys are sealed through supported operating-system credential protection and the renderer has no Node.js access. Neither client can protect plaintext from a fully compromised device or malicious code executing inside its trusted application origin.
