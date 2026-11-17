# Linux support

AutoMining 1.2.31 retains the Windows paths from 1.2.30 and adds Linux support
for legacy client archive installation, verification, removal and interrupted
swap recovery. Modern login delivery remains the preferred route on supported
EveJS versions, including 261115.2.

Use the normal Launcher mod controls. The same mod ZIP works on both systems.
Legacy Linux archive operations require Python 3, which is also required by the
prepared Linux launcher environment. Close clients before an archive change.
The stop guard checks the selected physical client and Wine paths; it never
terminates a client. Unknown or changed command modules and invalid backups
remain blocked. Other archive entries and existing settings are retained.

Native EVE/Proton gameplay and the in-game UI still require Linux hardware
qualification. Headless helper and archive tests do not establish gameplay.
