# coding: utf-8
# AutoMining HUD translations. Kept inside the login companion so each client
# uses its own language; saved settings and wire values always remain English.
import re as _am_re


def _am_language():
    value = None
    try:
        import localization as _am_localization
        getter = getattr(_am_localization, 'GetLanguageID', None)
        if callable(getter):
            value = getter()
    except Exception:
        pass
    if not value:
        value = getattr(session, 'languageID', None) or getattr(session, 'languageId', None)
    try:
        value = unicode(value or 'EN').strip().lower().replace('_', '-')
    except Exception:
        value = 'en'
    code = value.split('-')[0]
    return code if code in ('de', 'fr', 'es', 'it', 'ru', 'zh', 'ja', 'ko') else 'en'


_AM_NAMES = {
    'en': u'AutoMining', 'de': u'Automatischer Bergbau',
    'fr': u'Minage automatique', 'es': u'Minería automática',
    'it': u'Estrazione automatica', 'ru': u'Автодобыча',
    'zh': u'自动采矿', 'ja': u'自動採掘', 'ko': u'자동 채굴',
}

# Other language packs are loaded from the authored locale catalogue before
# the HUD is constructed. Never translate protocol names or saved settings.
_AM_TRANSLATIONS = {}
_AM_PATTERN_TRANSLATIONS = {}
_AM_MODE_NAMES = {
    'de': {'spread': u'Verteilen', 'focus': u'Bündeln'},
    'fr': {'spread': u'Répartir', 'focus': u'Concentrer'},
    'es': {'spread': u'Dispersar', 'focus': u'Concentrar'},
    'it': {'spread': u'Distribuisci', 'focus': u'Concentra'},
    'ru': {'spread': u'Распределение', 'focus': u'Фокус'},
    'zh': {'spread': u'分散', 'focus': u'集中'},
    'ja': {'spread': u'分散', 'focus': u'集中'},
    'ko': {'spread': u'분산', 'focus': u'집중'},
}


_AM_ZH = {
    'Connecting to AutoMining...': u'正在连接 AutoMining…',
    'Start / Resume': u'启动 / 继续', 'Stop': u'停止',
    'On / Off is saved per character': u'每个角色单独保存开关状态',
    'Apply saves changes in all tabs. Switching tabs keeps unsaved changes.': u'应用将保存所有分页的更改；切换分页不会丢失未保存的更改。',
    'Apply settings': u'应用设置', 'Reload': u'重新载入',
    'Mining': u'采矿', 'Mining drones': u'采矿无人机', 'Mining Filter': u'采矿筛选',
    'Drones': u'无人机', 'Boosters': u'增效', 'Return to station': u'返回空间站',
    'Automatic unloading': u'自动卸货', 'Unload and return to mining': u'卸货后返回采矿',
    'Ore hold trigger': u'矿石舱阈值', '% full (default 95)': u'% 已满（默认 95）',
    'At the trigger, dock, unload, return to this mining position and resume.': u'达到阈值后停靠、卸货，返回当前采矿位置并继续。',
    'Destination station': u'目标空间站', 'Find': u'查找',
    'Paste a station name; search covers all regions': u'粘贴空间站名称；搜索所有星域',
    'No station selected.': u'尚未选择空间站。',
    'Find a station, then select the matching result.': u'查找空间站，然后选择匹配的结果。',
    'No matching stations.': u'没有匹配的空间站。',
    'Station name changed. Click Find to resolve it.': u'空间站名称已更改。点击“查找”确认。',
    'Select a station from the results.': u'请从结果中选择空间站。',
    'Showing 30 results. Enter more of the station name to narrow the search.': u'显示前 30 个结果。请输入更完整的名称以缩小范围。',
    'Unload into': u'卸货位置', 'Select a station first': u'请先选择空间站',
    'Select storage': u'选择存储位置', 'Choose unload storage': u'选择卸货位置',
    'Previous storage unavailable - choose again': u'原存储位置不可用，请重新选择',
    'Personal item hangar': u'个人物品机库',
    'Container: ': u'货柜： ', 'Corporation - ': u'军团 - ',
    'Refresh storage': u'刷新存储位置',
    'Personal hangar, your containers, or accessible corporation divisions.\nIf unloading fails, the ship stays docked.': u'可选择个人机库、自己的货柜或有权限的军团机库分区。\n卸货失败时，舰船将留在空间站。',
    'Ore hold: waiting for ship data': u'矿石舱：等待舰船数据',
    'Ore hold: %.1f / %.1f m3 (%.1f%%)': u'矿石舱：%.1f / %.1f m³（%.1f%%）',
    'Automatic hauling is off.': u'自动运输已关闭。',
    'Autopilot follows your route settings. Manual travel cancels the trip.': u'自动导航遵循你的路线设置。手动航行会取消行程。',
    'Cancel return': u'取消返回',
    'Automatic mining drone orders': u'自动采矿无人机指令',
    'Make launched mining drones mine automatically': u'让已发射的采矿无人机自动采矿',
    'Uses the Mining Filter. An empty filter allows all ore.\nOnly drones launched by AutoMining receive mining orders.': u'使用采矿筛选；筛选为空时允许所有矿石。\n只有由 AutoMining 发射的无人机会收到采矿指令。',
    'Drone target priority': u'无人机目标优先级', 'Drone targeting mode': u'无人机目标模式',
    'Nearest first': u'最近优先', 'Furthest first': u'最远优先',
    'Largest volume first': u'剩余体积最大优先', 'Smallest volume first': u'剩余体积最小优先',
    'Spread: separate asteroids when possible': u'分散：尽量分配不同的小行星',
    'Focus: same best asteroid': u'集中：攻击同一优先小行星',
    'Filter order and highest grade first; this priority breaks ties.\nVolume means remaining cubic metres.': u'先按筛选顺序和最高等级排序；此优先级用于同级排序。\n体积指剩余立方米数。',
    'Mining orders are optional. Drone launch is configured in Drones.': u'采矿指令可选。无人机发射在“无人机”分页设置。',
    'Automatic mining orders are off.': u'自动采矿指令已关闭。',
    'At the mining site': u'在采矿地点', 'Launch drones on arrival': u'抵达后发射无人机',
    'Launch the selected group on arrival at a mining location while AutoMining is on, or when you click Start / Resume there.': u'AutoMining 开启时，抵达采矿地点便发射所选编组；也可在当地点击“启动 / 继续”发射。',
    'Choose an existing drone group, such as Fighters or Miners.': u'选择已有的无人机编组，例如 Fighters 或 Miners。',
    'Drone group to launch': u'要发射的无人机编组', 'Choose a drone group': u'选择无人机编组',
    'Saved group unavailable - refresh or choose again': u'已保存的编组不可用，请刷新或重新选择',
    'Refresh groups': u'刷新编组', 'Before travel': u'出发前',
    'Recall drones before warp / dock': u'跃迁 / 停靠前召回无人机',
    'Wait for controlled drones to reach the bay before manual warp/dock or hauling departure. Works while mining is off. Stop cancels a pending departure.': u'手动跃迁、停靠或运输出发前，等待受控无人机返回机库。采矿关闭时也有效；“停止”可取消待执行的出发。',
    'Wait for mining and combat drones to reach the bay, then continue travel.\nFleet warp waits for the members too.': u'等待采矿及战斗无人机返回机库后再继续航行。\n舰队跃迁也会等待成员。',
    'Automatic launch is off.': u'自动发射已关闭。',
    'Rat response': u'海盗应对', 'Rats detected: switch to fighter drones': u'发现海盗：切换战斗无人机',
    'Recall the selected mining group, launch the selected fighter group, then restore miners after rats leave the grid.': u'召回所选采矿编组，发射战斗编组；海盗离开网格后恢复采矿无人机。',
    'The selected fighter group returns afterward, unless it is your standard arrival group.': u'战斗结束后召回该编组；若它是默认抵达编组，则保持在外。',
    'Mining group to recall / restore': u'要召回 / 恢复的采矿编组',
    'Fighter group to launch': u'要发射的战斗编组',
    'Choose a mining group': u'选择采矿编组', 'Choose a fighter group': u'选择战斗编组',
    'Rat response is off.': u'海盗应对已关闭。',
    'Mining fleet boosts': u'采矿舰队增效',
    'Activate online mining command bursts': u'启动在线的采矿指挥脉冲',
    'Works on boosting ships without mining lasers. Requires fitted, online mining command burst modules and their charges.': u'可用于没有采矿激光器的增效船。需要已装配并在线、且装有弹药的采矿指挥脉冲模块。',
    'Invite nearby AutoMining pilots to fleet': u'邀请附近的 AutoMining 驾驶员入队',
    'Invite and automatically accept AutoMining pilots on the same grid after undocking, before warping to the mining site.': u'离站后、跃迁到采矿地点前，邀请同一网格中的 AutoMining 驾驶员并自动接受邀请。',
    'Start AutoMining on the booster and miners. Fleet invites run after undocking. Mining boosts begin 5 seconds after the booster arrives at a mining site.': u'在增效船和矿船上启动 AutoMining。离站后发送舰队邀请；增效船抵达采矿地点 5 秒后启动增效。',
    'Automatic mining boosts are off.': u'自动采矿增效已关闭。',
    'Targeting': u'目标选择', 'Lock targets automatically': u'自动锁定目标',
    'Approach out-of-range ore': u'接近射程外的矿石', 'Target priority': u'目标优先级',
    'Mining support': u'采矿辅助', 'Automatic survey': u'自动扫描',
    'Automatic compression': u'自动压缩', 'Survey seconds': u'扫描间隔（秒）',
    'Default 60 | Minimum 6': u'默认 60 | 最低 6',
    'No filter: all compatible resources': u'未筛选：所有兼容资源',
    'Add in priority order, or use Move up / Move down. Double-click to move one.\nA group mines IV > III > II > base; target priority breaks ties within a grade.': u'按优先级添加，或用“上移 / 下移”调整。双击可移动一项。\n编组按 IV > III > II > 基础等级采矿；同等级再按目标优先级排序。',
    'Available ores': u'可用矿石', 'Mining order (top first)': u'采矿顺序（顶部优先）',
    'Search available ore, ice or gas': u'搜索可用矿石、冰矿或气云',
    'Search active filter': u'搜索当前筛选', 'Add selected ores to the filter': u'将所选矿石加入筛选',
    'Remove selected ores from the filter': u'从筛选中移除所选矿石',
    'Move up': u'上移', 'Move down': u'下移', 'Clear filter': u'清空筛选',
    'No matching ores': u'没有匹配的矿石', 'No ores remaining': u'没有剩余矿石',
    'No active filter': u'没有启用的筛选',
    ' (group)': u' （编组）', 'base': u'基础',
    'Available ore / ice / gas (%s)': u'可用矿石 / 冰矿 / 气云（%s）',
    'Mining order: top first (%s)': u'采矿顺序：顶部优先（%s）',
    'Priority: entry 1 first, then entry 2': u'优先级：先第 1 项，再第 2 项',
    'Search area: ': u'搜索范围： ', 'whole current belt': u'当前整片矿带',
    'within mining range': u'采矿射程内',
    'nearest to furthest': u'由近到远', 'furthest to nearest': u'由远到近',
    'largest to smallest remaining volume': u'剩余体积由大到小',
    'smallest to largest remaining volume': u'剩余体积由小到大',
    'Mining Filter order and grade come first. Within one grade: %s.\n': u'优先按采矿筛选顺序和等级排序。同等级内：%s。\n',
    'Your ship may fly from one end of the current belt to the other to follow this order.': u'舰船可能横穿整片矿带以遵循此顺序。',
    'The mod will not move your ship. Asteroids outside effective mining range are ignored.': u'模组不会移动舰船；忽略有效射程外的小行星。',
    '\nVolume means remaining cubic metres, not ISK value.': u'\n体积指剩余立方米数，而非 ISK 价值。',
    '\nRequires an available Mining Surveyor or built-in equivalent. No scan required.': u'\n需要可用的采矿扫描器或内置等效功能；无需扫描。',
    'Select one active ore or group to move.': u'请选择一项当前矿石或编组来移动。',
    'Settings loaded. Choose your ores and click Apply.': u'设置已载入。选择矿石后点击“应用设置”。',
    'Unsaved changes. Click Apply, or Reload to discard.': u'有未保存的更改。点击“应用设置”保存，或“重新载入”放弃。',
    'Wait for the settings to load, then try again.': u'请等待设置载入后重试。',
    'Earlier changes saved. You have further unsaved changes.': u'先前的更改已保存；还有新的未保存更改。',
    'Settings saved.': u'设置已保存。',
    'Find a station and select unload storage before enabling hauling.': u'启用运输前，请查找空间站并选择卸货位置。',
    'Select a drone group before enabling automatic launch.': u'启用自动发射前，请选择无人机编组。',
    'Turn on mining boosts before enabling fleet invites.': u'启用舰队邀请前，请先开启采矿增效。',
    'Select different mining and fighter groups for rat response.': u'请为海盗应对选择不同的采矿和战斗编组。',
    'Could not load drone groups: ': u'无法载入无人机编组： ',
    'Character changed': u'角色已切换', 'AutoMining request failed': u'AutoMining 请求失败',
    'AutoMining could not open its settings. Restart the client through the Launcher after updating the mod.': u'无法打开 AutoMining 设置。更新模组后，请通过启动器重启客户端。',
    'ON': u'开启', 'OFF': u'关闭',
    'AutoMining is off.': u'AutoMining 已关闭。',
    'Paused for warp; resumes at a mining location.': u'跃迁期间暂停；抵达采矿地点后继续。',
    'Paused while docked. AutoMining resumes in space.': u'停靠期间暂停；进入太空后继续。',
    'Paused during travel or cloak.': u'航行或隐形期间暂停。',
    'Waiting to resume: no ore, ice or gas in this local grid.': u'等待继续：当前网格没有矿石、冰矿或气云。',
    'Waiting for arrival at a mining location, or Start / Resume here.': u'等待抵达采矿地点，或在此点击“启动 / 继续”。',
    'Waiting for the selected mining group to launch.': u'等待所选采矿编组发射。',
    'No AutoMining mining drones available in space.': u'太空中没有可用的 AutoMining 采矿无人机。',
    'No filtered ore on this mining grid.': u'当前采矿网格没有符合筛选条件的矿石。',
    'Requesting launch of the selected drone group.': u'正在请求发射所选无人机编组。',
    'Drone launch authorized; awaiting the native client.': u'无人机发射已获准；等待原生客户端。',
    'Drone launch finished.': u'无人机发射完成。',
    'No rats on this mining grid.': u'当前采矿网格没有海盗。',
    'Rats detected; checking named drone groups.': u'发现海盗；正在检查无人机编组。',
    'Rats gone; waiting briefly before switching drones.': u'海盗已消失；稍等后切换无人机。',
    'Rats gone; standard fighter group stays out.': u'海盗已消失；默认战斗编组保持在外。',
    'Rats gone; relaunching the mining group.': u'海盗已消失；正在重新发射采矿编组。',
    'Mining drone group restored.': u'采矿无人机编组已恢复。',
    'No online mining command burst modules fitted.': u'未装配在线的采矿指挥脉冲模块。',
    'Waiting for a mining site before activating boosts.': u'等待抵达采矿地点后启动增效。',
    'Waiting for a nearby grid before inviting pilots.': u'等待进入附近网格后邀请驾驶员。',
    'Waiting for other AutoMining pilots on this grid.': u'等待此网格中的其他 AutoMining 驾驶员。',
    'Autopilot to unload station.': u'正在自动导航至卸货空间站。',
    'Docked; unloading ore hold.': u'已停靠；正在卸载矿石舱。',
    'Unload confirmed; undocking.': u'卸货已确认；正在离站。',
    'Autopilot back to mining system.': u'正在自动导航返回采矿星系。',
    'Returning to saved mining position.': u'正在返回已保存的采矿位置。',
    'Returned to mining position; mining resumed.': u'已返回采矿位置；采矿已继续。',
    'Settings changed elsewhere. Click Reload before applying your changes.': u'设置已在别处更改。应用前请点击“重新载入”。',
    'Settings changed elsewhere. Click Reload.': u'设置已在别处更改。请点击“重新载入”。',
    'AutoMining settings applied.': u'AutoMining 设置已应用。',
    'Waiting to undock in the boosting ship.': u'等待增效船离站。',
    'Waiting to undock in a ship with online mining modules.': u'等待装有在线采矿模块的舰船离站。',
    'Looking for targets.': u'正在寻找目标。',
    'Waiting for matching resources nearby.': u'等待附近符合条件的资源。',
    'Waiting for compatible resources in range and room in the mining hold.': u'等待射程内兼容的资源，以及矿石舱中的可用空间。',
    'Waiting for target locks.': u'等待目标锁定。',
    'Waiting for a free target slot, capacitor or module readiness.': u'等待空闲目标槽、电容或模块就绪。',
    'Starting mining boosts.': u'正在启动采矿增效。',
    'Waiting for online mining modules.': u'等待在线的采矿模块。',
    'Paused; waiting for a mining ship in space.': u'已暂停；等待采矿舰船进入太空。',
    'Priority changed; choosing new targets.': u'优先级已更改；正在选择新目标。',
    'Compression unavailable; mining continues.': u'无法压缩；继续采矿。',
    'Waiting: volume priority needs an available Mining Surveyor or built-in equivalent. No scan is required. Choose Nearest/Furthest to mine without one.': u'等待中：体积优先级需要可用的采矿扫描器或内置等效功能，无需执行扫描。若没有，请选“最近 / 最远”优先。',
    'Interrupted hauling trip. Check your ship and route, then click Start / Resume.': u'运输行程中断。检查舰船及路线后点击“启动 / 继续”。',
    'Recalling drones before departure. Stop cancels departure.': u'出发前正在召回无人机；点击“停止”取消出发。',
    'Drones are returning before departure. Use Stop to cancel.': u'无人机正在返回；点击“停止”取消出发。',
    'AutoMining is already hauling. Use Stop to cancel the trip.': u'AutoMining 正在运输；点击“停止”取消行程。',
    'Drone launch request could not be delivered. Use Start / Resume to try again.': u'无人机发射请求无法送达。点击“启动 / 继续”重试。',
    'Fighter drones could not engage the detected rat; retrying shortly.': u'战斗无人机无法攻击发现的海盗；即将重试。',
    'Fighter attack order failed; retrying shortly.': u'战斗攻击指令失败；即将重试。',
    'Drone recall was refused; check the drone bay and controls.': u'无人机召回被拒绝；请检查无人机机库和控制权限。',
    'Could not read drone groups from the client.': u'无法从客户端读取无人机编组。',
    'Rats detected; fighter launch requested once for this encounter.': u'发现海盗；本次遭遇已请求发射战斗无人机。',
    'Rats detected; standard fighter group remains out.': u'发现海盗；默认战斗编组继续留在外面。',
    'Rats detected; fighter group is out.': u'发现海盗；战斗编组已在外面。',
    'Rats detected; waiting to launch the fighter group.': u'发现海盗；等待发射战斗编组。',
    'Fleet invites are off.': u'舰队邀请已关闭。',
    'Return trip cancelled.': u'返回行程已取消。',
    'Hauling cancelled after ship change.': u'更换舰船后运输已取消。',
    'Hauling paused: docked at a different station.': u'运输已暂停：停靠在另一座空间站。',
    'Hauling paused: client or trip timeout. Click Start / Resume to retry.': u'运输已暂停：客户端或行程超时。点击“启动 / 继续”重试。',
    'Hauling paused: unload, undock or return-position timeout.': u'运输已暂停：卸货、离站或返回位置超时。',
    'Hauling paused: reconnect with the updated AutoMining client companion.': u'运输已暂停：请使用已更新的 AutoMining 客户端组件重新连接。',
    'Hauling cancelled after destination settings changed.': u'目标设置更改后运输已取消。',
    'Automatic return from an instanced or gated site is not supported. Hauling has not started.': u'暂不支持从副本或需通过加速轨道的地点自动返回；运输未开始。',
    'Cannot save the current mining position.': u'无法保存当前采矿位置。',
    'Could not save return-trip safety state.': u'无法保存返回行程的安全状态。',
    'Ore hold was emptied before arrival; unload cannot be confirmed.': u'抵达前矿石舱已清空；无法确认卸货。',
    'Ore remains in the hold. The ship will stay docked.': u'矿石舱仍有矿石；舰船将保持停靠。',
    'Could not confirm ore in the selected storage. The ship will stay docked.': u'无法确认所选存储位置中的矿石；舰船将保持停靠。',
    'Ship is not in the saved mining system.': u'舰船不在已保存的采矿星系。',
    'Ship is in a different mining instance. Return cancelled.': u'舰船位于不同的采矿副本；返回已取消。',
    'Mining position has not been reached.': u'尚未抵达采矿位置。',
    'Could not save trip completion. Mining paused.': u'无法保存行程完成状态；采矿已暂停。',
    'Drone recall timed out. Travel cancelled; check drone range and bay capacity.': u'无人机召回超时；航行已取消。请检查无人机距离与机库容量。',
    'Drone return was refused. Travel cancelled; check drone access and bay capacity.': u'无人机返回被拒绝；航行已取消。请检查权限与机库容量。',
    'A drone is missing or no longer controlled; return to the bay cannot be confirmed. Travel cancelled.': u'无人机失踪或已失去控制；无法确认其返回机库，航行已取消。',
    'Native crystal loading was refused; check cargo and module state.': u'原生水晶装载被拒绝；请检查货舱及模块状态。',
    'Cannot unload the incompatible crystal; check free cargo space.': u'无法卸下不兼容的水晶；请检查货舱剩余空间。',
}

_AM_ZH.update({
    u" Applied for this session, but saving failed; check server log.": u" 已应用于本次会话，但保存失败；请检查服务器日志。",
    u"A character session is required.": u"需要一个角色会话。",
    u"A drone received another order. Departure cancelled.": u"无人机收到其他指令。出发已取消。",
    u"Auto-approach OFF after manual steering.": u"手动操控后，自动接近已关闭。",
    u"AutoMining OFF. Mining modules it started are stopping under normal cycle rules.": u"自动采矿已关闭。其启动的采矿模块将在正常循环规则下停止。",
    u"AutoMining needs a character session.": u"自动采矿需要角色会话。",
    u"AutoMining settings opened.": u"已打开自动采矿设置。",
    u"AutoMining unavailable: unsupported mining runtime; check the server log.": u"自动采矿不可用：不支持的采矿运行时；请检查服务器日志。",
    u"AutoMining: invalid survey interval.": u"自动采矿：勘测间隔无效。",
    u"Compression waiting for an accessible, active compressor in range.": u"等待范围内可使用的运行中压缩器。",
    u"Compression: no uncompressed resources aboard.": u"压缩：船上没有未压缩的资源。",
    u"Departure cancelled after a connection, ship or location change.": u"连接、飞船或位置变更后，出发已取消。",
    u"Departure cancelled after recall was disabled. Issue travel again to proceed without recall.": u"召回被禁用后，出发已取消。再次下达航行指令以继续无召回航行。",
    u"Departure cancelled by Stop.": u"出发因停止而取消。",
    u"Departure cancelled by manual navigation.": u"出发因手动导航而取消。",
    u"Departure cancelled.": u"出发已取消。",
    u"Departure replaced by a new destination.": u"出发已被新的目的地取代。",
    u"Drone launch is no longer authorized.": u"无人机发射不再被授权。",
    u"Drone state refresh is no longer authorized.": u"无人机状态刷新不再被授权。",
    u"Enter at least two characters of the station name.": u"请输入至少两个字符的站点名称。",
    u"Hauling departure cancelled.": u"运输出发已取消。",
    u"Hauling is unavailable.": u"运输不可用。",
    u"Invalid drone group membership.": u"无人机编队成员无效。",
    u"Invalid mining drone settings.": u"采矿无人机设置无效。",
    u"Loading a compatible mining crystal.": u"正在加载兼容的采矿晶体。",
    u"Mining drones could not accept an ore target; checking again shortly.": u"采矿无人机无法接受矿石目标；稍后重试。",
    u"No compatible crystal in cargo; incompatible crystal unloaded. Mining without a crystal.": u"货舱中没有兼容的水晶；已卸载不兼容的水晶。未使用水晶进行采矿。",
    u"Rat drone group request expired.": u"敌舰应对的无人机编组请求已过期。",
    u"Return movement was rejected.": u"返航移动指令被拒绝。",
    u"Return trip cancelled by manual navigation.": u"返回行程因手动导航而取消。",
    u"Return trip is no longer active.": u"返程已不再有效。",
    u"Select an existing station.": u"请选择一个现有的空间站。",
    u"Select separate mining and fighter groups for rat response; fleet invites require Auto Boost.": u"敌舰应对需要不同的采矿和战斗无人机编组；舰队邀请需要开启自动增效。",
    u"Select up to 30 valid station IDs.": u"最多选择 30 个有效的空间站 ID。",
    u"Selected storage is no longer available. Choose a storage destination again.": u"所选存储已不可用。请重新选择存储目的地。",
    u"Survey needs the AutoMining client companion. Relaunch the client through the Launcher after installing it.": u"勘测需要自动采矿客户端组件。安装后请通过启动器重新启动客户端。",
    u"Survey requested; waiting for the client.": u"已请求勘测；等待客户端。",
    u"Survey waiting: no ore, ice or gas in this local grid.": u"勘测等待中：此局部网格内无矿石、冰或气体。",
    u"Waiting for native crystal reload.": u"等待游戏装载采矿水晶。",
    u"Waiting: ship cannot approach right now.": u"等待中：飞船目前无法靠近。",
    u"AutoMining started.": u"自动采矿已启动。",
    u"AutoMining stopped.": u"自动采矿已停止。",
    u"Mining boost waiting: ": u"采矿增益等待中： ",
    u"Ready.": u"准备就绪。",
    u"activation refused": u"激活被拒绝"
})

_AM_ZH.update({
    'Use current station': u'使用当前空间站',
    'Dock at a station to use your current station.': u'请先停靠空间站，才能选择当前空间站。',
    'Current station could not be resolved.': u'无法识别当前空间站。',
    'Current station selected. Choose or confirm unload storage.': u'已选择当前空间站。请确认或选择卸货位置。',
    'Defense': u'防御',
    'Emergency retreat': u'紧急撤离',
    'Retreat to station when ship health is low': u'舰船耐久过低时撤回空间站',
    'Uses the destination and storage selected in Return to station. After unloading, AutoMining stays off.': u'使用“返回空间站”中选择的目的地和存储位置。卸货后自动采矿保持关闭。',
    'Watch shield': u'监控护盾',
    'Shield at or below (%)': u'护盾低于或等于（%）',
    'Shield retreat waits for drones while shield remains; it warps when shield is gone or armor takes damage.': u'护盾仍在时等待无人机；护盾耗尽或装甲受损时立即跃迁。',
    'Watch armor': u'监控装甲',
    'Armor at or below (%)': u'装甲低于或等于（%）',
    'Armor retreat orders drones home and warps immediately. Drones still outside may be left behind.': u'装甲触发撤离时命令无人机返航并立即跃迁；未返回的无人机可能被留在原地。',
    'Defense is off.': u'防御撤离已关闭。',
    'Defense armed.': u'防御撤离已就绪。',
    'Defense retreat: low shield.': u'防御撤离：护盾过低。',
    'Defense retreat: low armor.': u'防御撤离：装甲过低。',
    'Defense retreat complete. Ore unloaded; AutoMining is off.': u'防御撤离完成。矿石已卸载；自动采矿已关闭。',
    'Defense retreat complete. Docked; AutoMining is off.': u'防御撤离完成。已停靠；自动采矿已关闭。',
    'Defense retreat reached station; ore transfer could not be confirmed. AutoMining is off.': u'已撤回空间站，但无法确认矿石转移；自动采矿已关闭。',
    'Choose a station and unload storage before enabling hauling or Defense.': u'开启运输或防御撤离前，请先选择空间站及卸货位置。',
    'Select shield or armor for Defense.': u'请为防御撤离选择护盾或装甲。',
    'Select shield or armor and a threshold from 1 to 100 for Defense.': u'请为防御撤离选择护盾或装甲，并设置 1 至 100 的阈值。',
    'Defense retreat cancelled after a ship or location change.': u'舰船或位置变化后，防御撤离已取消。',
})

# Statistics, ore handling, industrial operations and action notifications.
_AM_ZH.update({
    'Ore handling': u'矿石处理',
    'Leave aboard': u'留在船上',
    'Jettison ore': u'抛出矿石',
    'Abandon jetcan': u'放弃抛出货柜',
    'Abandoning opens the can to other pilots and compatible NPC collectors.': u'放弃后，其他驾驶员及兼容的 NPC 收集者可以访问货柜。',
    'Jettison now': u'立即抛出',
    'Jettison now uses saved settings. Apply changes first.': u'立即抛出使用已保存的设置。请先应用更改。',
    'Auto-stack ore hold': u'自动堆叠矿石舱',
    'Auto-stack fleet hangar': u'自动堆叠舰队机库',
    'At the trigger, follow the selected ore handling mode.': u'达到阈值时执行所选矿石处理模式。',
    'Uses the destination and storage selected in Ore handling. After unloading, AutoMining stays off.': u'使用矿石处理中选择的目的地和仓库。卸货后 AutoMining 保持关闭。',
    'Industrial Core': u'工业核心',
    'Asteroid Ore Compressor': u'小行星矿石压缩器',
    'Automatic Industrial Core': u'自动工业核心',
    'Automatic Asteroid Ore Compressor': u'自动小行星矿石压缩器',
    'The active core cycle can block warp. Stop prevents future cycles.': u'核心运行周期可能阻止跃迁。停止操作会阻止后续周期。',
    'Activation interval follows successful starts; native cycle duration is the minimum.': u'激活间隔从成功启动时计算；最低值为原生周期时长。',
    'No supported fitted modules.': u'未装配受支持的模块。',
    'Equipment default: %s s | Fitted cycle: %s s': u'装备默认：%s 秒 | 装配周期：%s 秒',
    'Activation interval in seconds': u'激活间隔（秒）',
    'Reset to equipment default': u'恢复装备默认值',
    'Active: %s s remaining': u'运行中：剩余 %s 秒',
    'Waiting': u'等待中',
    'Fuel restocking': u'燃料补给',
    'Restock Heavy Water automatically': u'自动补充重水',
    'Heavy Water: waiting for ship data': u'重水：等待舰船数据',
    'Restock below remaining core cycles': u'剩余核心周期低于此值时补给',
    'Refill target in core cycles': u'补充目标（核心周期）',
    'Allow Heavy Water in cargo': u'允许在货舱存放重水',
    'Fuel station': u'燃料补给站',
    'Fuel source storage': u'燃料来源仓库',
    'Uses existing Heavy Water stock. Missing fuel or access leaves the ship docked.': u'使用现有重水库存。缺少燃料或访问权限时，舰船保持停靠。',
    'Heavy Water: %s units | %s cycles | Target: %s units': u'重水：%s 单位 | %s 周期 | 目标：%s 单位',
    'Choose a fuel station and source storage.': u'请选择燃料站及来源仓库。',
    'Statistics': u'统计',
    'Pilot': u'驾驶员',
    'Fleet': u'舰队',
    'Current run': u'当前轮次',
    'Today (UTC)': u'今天（UTC）',
    'Last 7 days (UTC)': u'最近 7 天（UTC）',
    'Since tracking began': u'自统计开始',
    'Start new run': u'开始新轮次',
    'Sessions': u'轮次记录',
    'Start new run archives your current run. Other fleet pilots keep their runs.': u'开始新轮次会归档您的当前轮次，其他舰队驾驶员的轮次不受影响。',
    'Counters start with this update. Native mining history is retained for 90 days.': u'计数从本次更新开始。原生采矿历史保留 90 天。',
    'Harvested m3': u'开采 m3',
    'Mining deliveries': u'采矿交付次数',
    'Completed docks': u'完成停靠次数',
    'Confirmed unloads': u'已确认卸货次数',
    'Recent activity': u'最近活动',
    'Previous': u'上一页',
    'Next': u'下一页',
    'Lasers: %.1f m3 | Drones: %.1f m3 | Average: %.1f m3/h': u'激光：%.1f m3 | 无人机：%.1f m3 | 平均：%.1f m3/h',
    'Run elapsed: %.1f min. Average includes idle time.': u'轮次时长：%.1f 分钟。平均值包含空闲时间。',
    'Current fleet operation only. Personal history is private.': u'仅显示当前舰队行动。个人历史不公开。',
    'Tracking began: %s. Days use UTC; historical docks are unavailable.': u'统计开始：%s。日期使用 UTC；没有历史停靠计数。',
    'Online': u'在线',
    'Offline': u'离线',
    'No statistics yet.': u'暂无统计。',
    'Harvested %s units of %s': u'已开采 %s 单位 %s',
    'Dock completed': u'停靠完成',
    'Unload confirmed': u'卸货已确认',
    'No recent activity.': u'暂无最近活动。',
    'Harvested: %.1f m3 | Units: %s': u'已开采：%.1f m3 | 单位：%s',
    'Run archived. A new run has started.': u'轮次已归档。新轮次已开始。',
    'Saved runs: %s (latest 50 retained)': u'已保存轮次：%s（保留最近 50 次）',
    'No saved runs. Start a new run to archive this one.': u'没有已保存轮次。开始新轮次可归档当前轮次。',
    'Choose a saved run to see its summary.': u'选择已保存轮次以查看摘要。',
    'Docks: %s | Unloads: %s': u'停靠：%s | 卸货：%s',
    'Find a setting...': u'查找设置...',
    'No matching settings.': u'没有匹配的设置。',
    'Found setting: %s': u'找到设置：%s',
    'Show AutoMining action messages': u'显示 AutoMining 操作消息',
    'Tools': u'工具',
    'MODS': u'模组',
    'Invalid statistics view.': u'统计视图无效。',
    'Mining started.': u'采矿已开始。',
    'Mining paused for warp.': u'采矿因跃迁暂停。',
    'Returning to station.': u'正在返回空间站。',
    'Docked; unloading ore.': u'已停靠；正在卸载矿石。',
    'Docked; restocking Heavy Water.': u'已停靠；正在补充重水。',
    'Transfer complete; undocking.': u'转移完成；正在离站。',
    'Returning to the mining site.': u'正在返回采矿地点。',
    'Mining resumed at the saved position.': u'已在保存位置恢复采矿。',
    'Fuel restocking complete.': u'燃料补给完成。',
    'Ore unloading complete.': u'矿石卸载完成。',
    'Ore jettison complete.': u'矿石抛出完成。',
    'Heavy Water reserve reached.': u'重水已达到储备阈值。',
    'Defense retreat: low shield.': u'防御撤离：护盾不足。',
    'Defense retreat: low armor.': u'防御撤离：装甲不足。',
    'Waiting for industrial core cycle before departure.': u'离开前等待工业核心周期结束。',
    'Manual industrial core active; stop it before departure.': u'手动工业核心正在运行；离开前请停止。',
    'Industrial core activated.': u'工业核心已激活。',
    'Asteroid ore compressor activated.': u'小行星矿石压缩器已激活。',
    'Mining boosts activated.': u'采矿增效已激活。',
    'Drones recalled before departure.': u'离开前已召回无人机。',
    'AutoMining action failed: %s': u'AutoMining 操作失败：%s',
    'Inventory stacks merged.': u'物品堆叠已合并。',
    'Invalid industrial activation intervals.': u'工业激活间隔无效。',
    'Invalid ore handling mode.': u'矿石处理模式无效。',
    'Invalid ore or industrial automation setting.': u'矿石或工业自动化设置无效。',
    'Invalid fuel restocking settings.': u'燃料补给设置无效。',
    'Industrial equipment is unavailable.': u'工业装备不可用。',
    'Choose a fuel station and source storage before enabling restocking.': u'开启补给前，请选择燃料站及来源仓库。',
    'Jettison is unavailable during travel or Defense.': u'航行或防御期间无法抛出。',
    'Invalid statistics request.': u'统计请求无效。',
    'Statistics are unavailable.': u'统计不可用。',
    'Invalid statistics history request.': u'统计历史请求无效。',
    'Waiting for the native jettison cooldown.': u'等待原生抛出冷却时间。',
    'No ore to jettison.': u'没有可抛出的矿石。',
    'Ore transferred to the existing jetcan.': u'矿石已转入现有抛出货柜。',
    'Jetcan has insufficient room for the remaining ore stack.': u'抛出货柜空间不足以容纳剩余矿石。',
    'Some ore could not be jettisoned.': u'部分矿石无法抛出。',
    'Ore jettisoned; this can will be reused.': u'矿石已抛出；此货柜将继续使用。',
    'Jetcan is public. Other pilots can take its contents.': u'货柜已公开。其他驾驶员可取走其中物品。',
    'Jetcan expires two hours after creation.': u'货柜将在创建两小时后过期。',
    'Native ore stack split could not be confirmed.': u'无法确认原生矿石堆叠拆分。',
    'Native jetcan abandonment was refused.': u'原生货柜放弃操作被拒绝。',
    'Native ore transfer could not be confirmed.': u'无法确认原生矿石转移。',
    'Native jetcan capacity is unavailable.': u'原生货柜容量不可用。',
    'No ore unit fits in a native jetcan.': u'没有矿石单位能装入原生货柜。',
    'Native jettison failed.': u'原生抛出失败。',
    'Native jettison inventory transfer could not be confirmed.': u'无法确认原生抛出库存转移。',
    'Could not save the tracked jetcan.': u'无法保存跟踪货柜。',
    'Could not save jetcan abandonment.': u'无法保存货柜放弃状态。',
    'Jettison paused: ': u'抛出已暂停： ',
    'Industrial shutdown waiting: ': u'等待工业关闭： ',
    'Industrial activation waiting: ': u'等待工业激活： ',
    'Waiting for a mining site before industrial activation.': u'工业激活前等待采矿地点。',
    'Fuel reserve reached; waiting to restock.': u'已达到燃料储备阈值；等待补给。',
    'Compressor waiting for an active industrial core.': u'压缩器等待工业核心激活。',
    'Compressor waiting for the next full core cycle window.': u'压缩器等待下一个完整核心周期窗口。',
    'Industrial automation active.': u'工业自动化已运行。',
    'Activation interval must be between %s and 86400 seconds.': u'激活间隔必须介于 %s 和 86400 秒之间。',
    'Refill target must exceed reserve.': u'补充目标必须高于储备阈值。',
    'Stop fleet AutoMining': u'停止舰队 AutoMining',
    'Stop AutoMining for all pilots in your fleet?': u'停止您舰队所有驾驶员的 AutoMining？',
    'AutoMining stopped for %d fleet pilot(s).': u'已停止 %d 名舰队驾驶员的 AutoMining。',
    'Only the fleet boss can stop fleet AutoMining.': u'只有舰队队长可以停止舰队 AutoMining。',
    'You are not in a fleet.': u'您不在舰队中。',
    'Transfer confirmed; undocking.': u'转移已确认；正在离站。',
    'Heavy Water transfer could not be confirmed. The ship will stay docked.': u'无法确认重水转移。舰船将保持停靠。',
    'Fuel refill target must exceed the reserve by at least one core cycle. Ship will stay docked.': u'补充目标必须至少高于储备一个核心周期。舰船将保持停靠。',
    'Heavy Water volume is unavailable.': u'重水体积数据不可用。',
    'Not enough accessible Heavy Water or ship capacity above the fuel reserve. Ship will stay docked.': u'可用重水或舰船容量不足以超过储备阈值。舰船将保持停靠。',
    'Stop fleet AutoMining and recall deployed drones?': u'停止舰队 AutoMining 并召回已部署无人机？',
    'AutoMining stopped for %d fleet pilot(s). Recall ordered: %d. Recall failures: %d.': u'已停止 %d 名驾驶员的 AutoMining。已下令召回：%d。召回失败：%d。',
    'Not ready to confirm Heavy Water restocking.': u'尚无法确认重水补给。',
    'Only the current fleet boss can stop fleet AutoMining.': u'只有当前舰队队长可以停止舰队 AutoMining。',
    'Most mined resource: %s': u'开采最多的资源：%s',
})

# Fleet transport labels and native operation messages.
_AM_ZH.update({
    'Select Transport role': u'选择运输角色',
    'Departure replaced by Defense retreat.': u'出发已被防御撤退取代。',
    'Hauling cancelled after ship role changed.': u'舰船角色更改后，搬运已取消。',
    'Interrupted transport trip. Check your ship and route, then click Start / Resume.': u'运输航程已中断。请检查舰船和路线，然后点击启动 / 继续。',
    'Invalid AutoMining settings request.': u'AutoMining 设置请求无效。',
    'Invalid AutoMining settings. Check the survey interval and ore list.': u'AutoMining 设置无效。请检查勘测间隔和矿石列表。',
    'Invalid drone recall setting.': u'无人机召回设置无效。',
    'Invalid rat drone groups.': u'对 NPC 无人机编组无效。',
    'Invalid return-to-station settings.': u'返回空间站设置无效。',
    'Rat situation changed before drone launch.': u'无人机放出前 NPC 状况已改变。',
    'Transport settings changed.': u'运输设置已更改。',
    'Autopilot could not be enabled.': u'无法启用自动导航。',
    'No route to the selected destination with your route settings.': u'按当前路线设置无法到达所选目的地。',
    'Not docked at the selected station.': u'未停靠在所选空间站。',
    'Fleet ore collected': u'已收集舰队矿石',
    'Collected ore delivered': u'收集的矿石已送达',
    'Activity completed': u'活动已完成',
    'Transport collected: %.1f m3 | Delivered: %.1f m3 | Pickups: %d | Deliveries: %d': u'运输收集：%.1f 立方米 | 已送达：%.1f 立方米 | 取货：%d 次 | 交货：%d 次',
    'Both role selectors share one setting. Start / Stop remains the master switch.': u'两个角色选择器共用一项设置。启动 / 停止仍是总开关。',
    'Fleet pickup paused: %s': u'舰队取货已暂停：%s',
    'Fleet pickup paused: ': u'舰队取货已暂停： ',
    'Transport': u'运输',
    'Ship role': u'舰船角色',
    'Boosting': u'增效',
    'Request fleet pickup': u'请求舰队取货',
    'Request pickup now': u'立即请求取货',
    'Ore stays aboard until the assigned hauler arrives. Uses saved settings.': u'矿石保留在船上，直到指定运输船到达。使用已保存的设置。',
    'Waiting for ship eligibility.': u'等待舰船资格检查。',
    'Transport suspends mining, boosts, cores and compressors. Their settings are kept.': u'运输会暂停采矿、增效、核心和压缩器。其设置会保留。',
    'Enable fleet transport': u'启用舰队运输',
    'Registration requires Start, the Transport role, an eligible ship and a fleet.': u'登记需要启动自动采矿、选择运输角色、使用合格舰船并加入舰队。',
    'Unload at hold fullness (%)': u'货舱满度达到此百分比时卸货',
    'Unload partial cargo after idle seconds': u'空闲指定秒数后卸载未满的货物',
    'Transport destination': u'运输目的地',
    'Transport station': u'运输空间站',
    'Transport storage': u'运输仓库',
    'Personal or accessible corporation storage. Native permissions apply when unloading.': u'使用个人或有权访问的军团仓库。卸货时遵守游戏原生权限。',
    'Current job and queue': u'当前任务及队列',
    'Transport is off.': u'运输已关闭。',
    'No active transport job.': u'没有进行中的运输任务。',
    'No pickup requests.': u'没有取货请求。',
    'Eligible ore transport ship.': u'合格的矿石运输船。',
    'This ship cannot use the Transport role.': u'此舰船无法使用运输角色。',
    'Routing to pickup': u'前往取货星系',
    'Warping to pilot': u'跃迁至驾驶员',
    'Approaching pickup': u'接近取货点',
    'Collecting ore': u'收集矿石',
    'Delivering ore': u'运送矿石',
    'Unloading ore': u'卸载矿石',
    'Undocking': u'出站',
    'Waiting': u'等待',
    'Pickup from %s': u'从 %s 取货',
    '%.1f m3 waiting': u'%.1f 立方米待取货',
    'Invalid transport settings.': u'运输设置无效。',
    'Choose a transport station and unload storage before enabling Transport.': u'启用运输前，请选择运输空间站和卸货仓库。',
    'Transport is unavailable.': u'运输不可用。',
    'Transport request is too large.': u'运输请求过大。',
    'Transport paused: select an eligible ship.': u'运输已暂停：请选择合格舰船。',
    'Waiting for industrial equipment to stop before Transport.': u'等待工业设备停止后再开始运输。',
    'Waiting for transport travel to finish before Boosting.': u'等待运输航行结束后再开始增效。',
    'Transport paused: %s': u'运输已暂停：%s',
    'Transport paused: ': u'运输已暂停： ',
    'Transport job interrupted.': u'运输任务已中断。',
    'Transport request failed.': u'运输请求失败。',
    'Transport job changed.': u'运输任务已更改。',
    'Route changed manually. Transport cancelled.': u'路线被手动更改。运输已取消。',
    'Autopilot was stopped. Transport cancelled.': u'自动导航已停止。运输已取消。',
    'Autopilot is already in use. Transport paused.': u'自动导航已被使用。运输已暂停。',
    'Transport transfer authorization changed.': u'运输货物转移授权已更改。',
    'Transport ballpark is unavailable.': u'运输空间场景不可用。',
    'Transport cancelled.': u'运输已取消。',
    'Fleet pickup requested.': u'已请求舰队取货。',
    'Transport ready for fleet pickup.': u'运输船已准备好为舰队取货。',
    'Transport needs a fleet and updated client companion.': u'运输需要加入舰队并更新客户端组件。',
    'Fleet pickup needs an enabled miner in public fleet space.': u'舰队取货需要在公共空间中的舰队采矿员启用自动采矿。',
    'No ore is available for fleet pickup.': u'没有可供舰队取货的矿石。',
    'Could not save transport safety state.': u'无法保存运输安全状态。',
    'Transport lease no longer belongs to this pilot.': u'此运输任务已不再分配给该驾驶员。',
    'Transport client or trip timed out.': u'运输客户端或航程已超时。',
    'Pickup miner changed fleet, ship or location.': u'待取货采矿员更换了舰队、舰船或位置。',
    'Instanced or gated transport is not supported.': u'不支持副本空间或加速轨道后的运输。',
    'Transport ship no longer has an eligible ore hold.': u'运输船已没有合格的矿石舱。',
    'Transport docked outside its assigned destination.': u'运输船停靠在指定目的地之外。',
    'Collected ore disappeared before unload receipt.': u'收集的矿石在卸货确认前消失。',
    'Transport operation timed out.': u'运输操作已超时。',
    'Could not save transport completion.': u'无法保存运输完成状态。',
    'Assigned jetcan is unavailable or has no fleet loot rights.': u'指定抛出货柜不可用或没有舰队拾取权限。',
    'Transport ore hold is unavailable.': u'运输矿石舱不可用。',
    'No ore stack fits the transport hold.': u'没有矿石堆可以放入运输货舱。',
    'Transport job is no longer active.': u'运输任务已不再有效。',
    'Invalid transport action payload.': u'运输操作数据无效。',
    'Transport action token expired.': u'运输操作令牌已过期。',
    'Not ready for pickup warp.': u'尚未准备好取货跃迁。',
    'Unexpected pickup warp acknowledgment.': u'意外的取货跃迁确认。',
    'Not ready for pickup approach.': u'尚未准备好接近取货点。',
    'Not ready for pickup arrival.': u'尚未准备好确认取货到达。',
    'Existing jetcan has no current fleet loot rights.': u'现有抛出货柜没有当前舰队拾取权限。',
    'Not ready to collect ore.': u'尚未准备好收集矿石。',
    'Pickup stack changed.': u'待取货矿石堆已更改。',
    'No authorized ore transfer to confirm.': u'没有已授权的矿石转移可供确认。',
    'Pickup moved outside native transfer range.': u'取货目标已移出游戏原生转移范围。',
    'Native ore transfer receipt could not be verified.': u'无法验证游戏原生矿石转移结果。',
    'Not ready to unload collected ore.': u'尚未准备好卸载收集的矿石。',
    'Unexpected unload acknowledgment.': u'意外的卸货确认。',
    'Collected ore remains aboard.': u'收集的矿石仍在船上。',
    'Collected ore was not received in the selected storage.': u'所选仓库未收到收集的矿石。',
    'Unknown transport action.': u'未知运输操作。',
    'Pickup cancelled after miner location changed.': u'采矿员位置更改后，取货已取消。',
    'Ship is not eligible for public fleet transport.': u'此舰船不符合公共空间舰队运输要求。',
    'Transport cancelled by client.': u'运输被客户端取消。',
    'Travelling to fleet pickup system.': u'前往取货星系',
    'Warping to fleet pickup.': u'跃迁至驾驶员',
    'Approaching fleet pickup.': u'接近取货点',
    'Collecting fleet ore.': u'收集矿石',
    'Transporting ore to station.': u'运送矿石',
    'Docked; unloading collected ore.': u'卸载矿石',
    'Transport undocking.': u'出站',
})

# Jobs, PVE and shared fleet management.
_AM_ZH.update({
    'Start registers an eligible, configured hauling ship for fleet pickups.': u'启动会将符合条件且已配置的搬运舰船登记为舰队取货运输船。',
    'Configure fleet membership on the Fleet page. Mining boosts begin 5 seconds after arrival.': u'请在舰队页面配置成员。采矿增效在到达后 5 秒开始。',
    'Choose station and storage': u'选择空间站和仓库',
    'Retreat and mining unload destination': u'撤退及采矿卸货目的地',
    'Belt catalog is too large.': u'小行星带目录过大。',
    'AutoMining job started.': u'AutoMining 任务已启动。',
    'Belt search is unavailable.': u'小行星带搜索不可用。',
    'Choose a hauling ship and drop-off destination before starting.': u'启动前请选择搬运舰船和交货目的地。',
    'Choose an asteroid belt before starting PVE.': u'启动 PVE 前请选择小行星带。',
    'Interrupted PVE trip. Check your ship and route, then click Start / Resume.': u'PVE 航程已中断。请检查舰船和路线，然后点击启动 / 继续。',
    'Invalid PVE action.': u'PVE 操作无效。',
    'Invalid fleet request.': u'舰队请求无效。',
    'Job started.': u'任务已启动。',
    'PVE waiting to leave station.': u'PVE 正在等待离站。',
    'Select a combat drone group before enabling PVE drones.': u'启用 PVE 无人机前请选择战斗无人机编组。',
    'Select separate mining and fighter groups for rat response.': u'应对 NPC 时请选择独立的采矿和战斗编组。',
    'Selected asteroid belt is unavailable.': u'所选小行星带不可用。',
    'Invalid job settings.': u'任务设置无效。',
    'Invalid belt catalog page.': u'小行星带目录页无效。',
    'Autopilot is already in use. PVE paused.': u'自动导航已被使用。PVE 已暂停。',
    'Autopilot was stopped. PVE cancelled.': u'自动导航已停止。PVE 已取消。',
    'No route to the selected belt with your route settings.': u'按当前路线设置无法到达所选小行星带。',
    'PVE ballpark is unavailable.': u'PVE 空间场景不可用。',
    'PVE job changed.': u'PVE 任务已更改。',
    'PVE job interrupted.': u'PVE 任务已中断。',
    'PVE request failed.': u'PVE 请求失败。',
    'Route changed manually. PVE cancelled.': u'路线被手动更改。PVE 已取消。',
    'Jobs': u'任务',
    'Hauling': u'搬运',
    'PVE': u'PVE',
    'Selected job: %s': u'所选任务：%s',
    'Selected job: Mining': u'所选任务：采矿',
    'Choose one job. Settings for other jobs stay saved. Start / Stop controls the selected job.': u'请选择一项任务。其他任务的设置会保留。启动 / 停止控制所选任务。',
    'Mine ore, ice or gas with lasers and drones.': u'使用激光和无人机开采矿石、冰矿或气云。',
    'Collect fleet ore and deliver it to your station.': u'收集舰队矿石并运送到您的空间站。',
    'Run mining boosts, industrial equipment and fuel restocking.': u'运行采矿增效、工业设备并补充燃料。',
    'Hunt hostile rats on a selected asteroid belt.': u'在所选小行星带猎杀敌对 NPC。',
    'Fleet, Defense and Statistics are shared by every job.': u'舰队、防御和统计为所有任务共用。',
    'Find a setting for this job...': u'查找此任务的设置…',
    'Switch job': u'切换任务',
    'Stop the current job and switch? The new job will wait for Start.': u'停止当前任务并切换？新任务会等待您点击启动。',
    'Job switched. Configure it, then press Start.': u'任务已切换。请配置后点击启动。',
    'Pickup style': u'取货方式',
    'Jettison a bin and let the hauler approach': u'抛出货柜并让运输船接近',
    'Keep ore aboard until the hauler arrives': u'运输船到达前将矿石保留在船上',
    'Weapon fire mode': u'武器开火模式',
    'Focus fire': u'集中火力',
    'Spread fire': u'分散火力',
    'Hostile priority': u'敌人优先级',
    'Strongest first': u'最强优先',
    'Weakest first': u'最弱优先',
    'Asteroid belt': u'小行星带',
    'Search belt or system name...': u'搜索小行星带或星系名称…',
    'Find belts': u'查找小行星带',
    'Find a belt, then select the matching result.': u'查找小行星带，然后选择匹配结果。',
    'No belt selected.': u'未选择小行星带。',
    'No matching belts.': u'没有匹配的小行星带。',
    'Weapon range': u'武器射程',
    'Waiting for fitted weapon data.': u'等待已装配武器的数据。',
    'Orbit range override in meters (0 = automatic)': u'覆盖环绕距离，单位米（0 = 自动）',
    'Automatic range follows your fitted weapons, ammunition and skills.': u'自动距离根据已装配的武器、弹药和技能计算。',
    'Automatic range: %.0f m | Current orbit: %.0f m | Weapons: %d': u'自动距离：%.0f 米 | 当前环绕：%.0f 米 | 武器：%d',
    'Use PVE drones': u'使用 PVE 无人机',
    'No groups found - refresh': u'未找到编组，请刷新',
    'Refresh drone groups': u'刷新无人机编组',
    'Enable shared fleet management': u'启用共用舰队管理',
    'Manual fleet': u'手动舰队',
    'Automatic fleet': u'自动舰队',
    'Fleet mode': u'舰队模式',
    'Fleet preset': u'舰队预设',
    'Fleet management is off.': u'舰队管理已关闭。',
    'Manual mode keeps fleet membership under your control. Automatic mode uses the selected preset.': u'手动模式由您控制舰队成员。自动模式使用所选预设。',
    'Select a fleet preset': u'选择舰队预设',
    'Fleet preset name...': u'舰队预设名称…',
    'Save fleet preset': u'保存舰队预设',
    'Delete fleet preset': u'删除舰队预设',
    'Refresh fleet roster': u'刷新舰队名单',
    'Saved preset unavailable': u'已保存预设不可用',
    'Fleet preset saved.': u'舰队预设已保存。',
    'Fleet roster refreshed.': u'舰队名单已刷新。',
    'Fleet coordination is off.': u'舰队协调已关闭。',
    'Fleet group ready.': u'舰队编组已就绪。',
    'Choose a fleet preset containing this pilot.': u'请选择包含此驾驶员的舰队预设。',
    'Waiting for a settled public grid.': u'等待公共空间网格稳定。',
    'Keeping the origin fleet during travel.': u'航行期间保留原舰队。',
    'Existing manual fleet is preserved.': u'现有手动舰队已保留。',
    'Waiting for the existing fleet invite.': u'等待现有舰队邀请。',
    'Fleet coordination paused: %s': u'舰队协调已暂停：%s',
    'Fleet coordination paused: ': u'舰队协调已暂停： ',
    'Working': u'工作中',
    'Travelling': u'航行中',
    'Unloading': u'卸货中',
    'Collecting': u'收集中',
    'Refueling': u'补充燃料中',
    'Retreated': u'已撤退',
    'Ready': u'就绪',
    'Offline': u'离线',
    'Invalid fleet preset action.': u'舰队预设操作无效。',
    'Fleet presets changed. Refresh and try again.': u'舰队预设已更改。请刷新后重试。',
    'Invalid fleet preset.': u'舰队预设无效。',
    'Fleet preset no longer exists.': u'舰队预设已不存在。',
    'Fleet preset limit reached.': u'已达到舰队预设上限。',
    'Invalid fleet preset file. Existing file was preserved.': u'舰队预设文件无效。现有文件已保留。',
    'PVE is off.': u'PVE 已关闭。',
    'Choose an asteroid belt for PVE.': u'请为 PVE 选择小行星带。',
    'PVE needs the updated client companion.': u'PVE 需要更新客户端组件。',
    'Travelling to the selected belt.': u'正在前往所选小行星带。',
    'Warping to the selected belt.': u'正在跃迁至所选小行星带。',
    'PVE undocking.': u'PVE 正在出站。',
    'No hostile rats on this belt grid.': u'此小行星带网格没有敌对 NPC。',
    'No usable offensive weapons are fitted.': u'未装配可用的进攻武器。',
    'Engaging hostile rats.': u'正在攻击敌对 NPC。',
    'Waiting for native target locks.': u'等待原生目标锁定。',
    'Waiting for native weapon range or ammunition.': u'等待原生武器射程或弹药。',
    'PVE stopped.': u'PVE 已停止。',
    'PVE client or trip timed out.': u'PVE 客户端或航程已超时。',
    'PVE job no longer belongs to this pilot.': u'PVE 任务已不再分配给此驾驶员。',
    'Instanced or gated PVE is not supported.': u'不支持副本空间或加速轨道后的 PVE。',
    'PVE action token expired.': u'PVE 操作令牌已过期。',
    'PVE job is no longer active.': u'PVE 任务已不再有效。',
    'Unknown PVE action.': u'未知 PVE 操作。',
    'Invalid PVE action payload.': u'PVE 操作数据无效。',
    'Could not save PVE safety state.': u'无法保存 PVE 安全状态。',
    'Could not save PVE completion.': u'无法保存 PVE 完成状态。',
    'PVE cancelled by client.': u'PVE 被客户端取消。',
    'Select an existing asteroid belt.': u'请选择现有小行星带。',
    'Enter at least two characters of the belt or system name.': u'请输入至少两个小行星带或星系名称字符。',
    'PVE paused; use Start / Resume to retry.': u'PVE 已暂停；点击启动 / 继续重试。',
})

# Stationary fleet hangar collection.
_AM_ZH.update({
    'Fleet ore collection': u'舰队矿石收集',
    'Receive fleet ore': u'接收舰队矿石',
    'Nearby fleet miners transfer accepted ore into your fleet hangar. Compressed-only reception waits for compression.': u'附近的舰队采矿员会将允许接收的矿石转移到您的舰队机库。仅接收压缩矿石时会等待压缩。',
    'Fleet ore collection is off.': u'舰队矿石收集已关闭。',
    'Waiting for fleet compression.': u'等待舰队压缩。',
})

# PVE and hauling statistics.
_AM_ZH.update({
    'Collected m3': u'已收集立方米',
    'Delivered m3': u'已送达立方米',
    'Completed pickups': u'已完成取货',
    'Transport deliveries': u'运输交货',
    'Rats destroyed': u'已摧毁 NPC',
    'Damage dealt': u'造成伤害',
    'Elapsed minutes': u'已用分钟',
    'PVE rats destroyed: %d | Damage dealt: %.1f': u'PVE 已摧毁 NPC：%d | 造成伤害：%.1f',
    'Collected: %.1f m3 | Delivered: %.1f m3': u'已收集：%.1f 立方米 | 已送达：%.1f 立方米',
})

# Native stationary fleet ore reception statuses.
_AM_ZH.update({
    'Fleet ore reception is off.': u'舰队矿石接收已关闭。',
    'Fleet ore reception waits while travelling.': u'航行期间暂停接收舰队矿石。',
    'Fleet ore reception needs a fleet hangar and mining hold.': u'接收舰队矿石需要舰队机库和矿石舱。',
    'Fleet ore received into the mining hold.': u'舰队矿石已收入矿石舱。',
    'Fleet ore received into the fleet hangar.': u'舰队矿石已收入舰队机库。',
    'Waiting for nearby mining pilots and fleet hangar access.': u'等待附近采矿员及舰队机库访问权限。',
    'Fleet ore reception paused: %s': u'舰队矿石接收已暂停：%s',
    'Fleet ore reception paused: ': u'舰队矿石接收已暂停： ',
    'Native fleet ore transfer could not be confirmed.': u'无法确认原生舰队矿石转移。',
})

# Committed native combat events.
_AM_ZH.update({
    'Rat destroyed.': u'NPC 已摧毁。',
    'Damage dealt: %.1f': u'造成伤害：%.1f',
})

_AM_ZH['Live combat statistics are unavailable; restart the server.'] = u'实时战斗统计不可用；请重启服务器。'

_AM_ZH['Fleet ore storage is full.'] = u'舰队矿石储存空间已满。'

_AM_ZH['Enable shared hauling'] = u'启用共享运输'

_AM_ZH['Haulers wait in a shared pool, join the assigned pickup fleet, and leave after docking.'] = u'运输员在共享队列中等待，接单后加入指定的取货舰队，并在停靠后离开舰队。'

_AM_ZH['Fleet: %s | Reserved bin: %s'] = u'舰队：%s | 已预留货柜：%s'

_AM_ZH['Start the Mining job before requesting pickup.'] = u'请先启动采矿任务，再请求取货。'

_AM_ZH['Choose Fleet pickup in Ore handling before requesting pickup.'] = u'请先在矿石处理设置中选择舰队取货，再请求取货。'

_AM_ZH['Join a native fleet before requesting pickup.'] = u'请先加入游戏舰队，再请求取货。'

_AM_ZH['Pickup session is no longer current.'] = u'取货会话已失效。'

_AM_ZH['Undock the mining ship before requesting pickup.'] = u'请先让采矿船离站，再请求取货。'

_AM_ZH['Pickup requires the current mining ship in space.'] = u'取货需要当前采矿船处于太空中。'

_AM_ZH['Fleet pickup is unavailable in private space.'] = u'私人空间中无法进行舰队取货。'

_AM_ZH['Wait for warp or docking to finish before requesting pickup.'] = u'请等待跃迁或停靠完成，再请求取货。'

_AM_ZH['Finish the current trip before requesting pickup.'] = u'请先完成当前行程，再请求取货。'

_AM_ZH['Joining the pickup fleet.'] = u'正在加入取货舰队。'

_AM_ZH['Transport ready for global fleet pickups.'] = u'运输员已就绪，可跨舰队取货。'

_AM_ZH['For requests in another fleet, leave the current fleet first.'] = u'要接收其他舰队的请求，请先离开当前舰队。'

_AM_ZH['Temporary pickup fleet will be left after docking.'] = u'停靠后将离开临时取货舰队。'

_AM_ZH['Pickup fleet join timed out.'] = u'加入取货舰队超时。'

_AM_ZH['Pickup bin is already reserved by another hauler.'] = u'取货货柜已被另一位运输员预留。'

_AM_ZH['Global pickup queue is full; try again shortly.'] = u'共享取货队列已满，请稍后重试。'

_AM_ZH['Fleet coordination is managed by the hauling job.'] = u'舰队协调由运输任务管理。'

_AM_ZH['Select Fleet pickup and apply settings before requesting pickup.'] = u'请先选择舰队取货并应用设置，再请求取货。'

_AM_ZH['Request pickup uses saved settings. Apply changes first.'] = u'取货请求使用已保存的设置。请先应用更改。'

_AM_ZH['Shared pool: %d hauler(s), %d available, %d request(s)'] = u'共享队列：%d 位运输员，%d 位可用，%d 个请求'

_AM_ZH['(left fleet)'] = u'（已离开舰队）'

_AM_ZH['Fleet totals include earlier contributors not shown.'] = u'舰队总计包含此处未显示的早期参与者贡献。'

_AM_ZH['The shared pool assigns pickups. Haulers join temporarily when needed and leave after docking. Existing fleets are preserved.'] = u'共享队列分配取货任务。运输员会在需要时临时加入舰队，并在停靠后离开。现有舰队保持不变。'

_AM_ZH["Put into booster's fleet hangar"] = u'放入加成舰的舰队机库'

_AM_ZH['Requires Receive fleet ore, the same fleet, hangar access and 2500 m range. The booster chooses which ore to accept.'] = u'需要启用接收舰队矿石、处于同一舰队、拥有机库访问权限并在2500米内。交付遵循加成舰的矿石接收选项。'

_AM_ZH['Fleet ore delivery needs an enabled receiver in this fleet.'] = u'舰队矿石交付需要本舰队中已启用接收的舰船。'

_AM_ZH['Fleet ore delivery needs a nearby stationary booster within 2500 m.'] = u'舰队矿石交付需要2500米内有静止的加成舰。'

_AM_ZH['Fleet ore delivery needs fleet hangar access.'] = u'舰队矿石交付需要舰队机库访问权限。'

_AM_ZH['Waiting for ore to deliver to the fleet hangar.'] = u'正在等待可交付到舰队机库的矿石。'

_AM_ZH['Ore ready for delivery to the fleet hangar.'] = u'矿石已准备好交付到舰队机库。'

_AM_ZH["Ore delivered to the booster's fleet hangar."] = u'矿石已交付到加成舰的舰队机库。'

_AM_ZH['Fleet ore delivery paused: '] = u'舰队矿石交付已暂停： '

_AM_ZH['Accept compressed ore'] = u'接收压缩矿石'
_AM_ZH['Accept uncompressed ore'] = u'接收未压缩矿石'

_AM_ZH['Fleet ore admission is off.'] = u'舰队矿石接收已关闭。'
_AM_ZH['Booster accepts compressed ore only; raw ore stays aboard.'] = u'加成舰仅接收压缩矿石；未压缩矿石留在船上。'
_AM_ZH['Booster accepts uncompressed ore only; compressed ore stays aboard.'] = u'加成舰仅接收未压缩矿石；压缩矿石留在船上。'

_AM_ZH['Belt patrol'] = u'矿带巡逻'
_AM_ZH['Fleet escort'] = u'舰队护航'
_AM_ZH['Reinforcement standby'] = u'增援待命'
_AM_ZH['Refresh fleets'] = u'刷新舰队'
_AM_ZH['Choose a fleet'] = u'选择舰队'
_AM_ZH['Default anchor'] = u'默认锚点'
_AM_ZH['Escort remains assigned after docking. Apply settings, then Start.'] = u'停靠后仍保留护航分配。应用设置后再启动。'
_AM_ZH['Home station'] = u'驻地空间站'
_AM_ZH['Maximum route jumps'] = u'最大航线跳数'
_AM_ZH['0 jumps means this system, not this grid. Return home after 60 seconds without threats.'] = u'0跳表示当前星系，并非当前网格。威胁消失60秒后返回驻地。'
_AM_ZH['No reinforcement requests.'] = u'没有增援请求。'
_AM_ZH['%s | %s | %d pilots | %s jumps'] = u'%s | %s | %d名驾驶员 | %s跳'
_AM_ZH['Fleet %s | %s'] = u'舰队%s | %s'
_AM_ZH['%d available | %d requests'] = u'%d名可用 | %d个请求'
_AM_ZH['Fleet %s | %s | %s jumps | %d/%d responders'] = u'舰队%s | %s | %s跳 | %d/%d名增援'
_AM_ZH['%d s ago'] = u'%d秒前'
_AM_ZH['Reinforcements'] = u'增援'
_AM_ZH['Request reinforcements when attacked'] = u'遭受攻击时请求增援'
_AM_ZH['Call reinforcements'] = u'呼叫增援'
_AM_ZH['Responder limit'] = u'增援人数上限'
_AM_ZH['Assignment'] = u'分配'
_AM_ZH['Joinable'] = u'可以加入'
_AM_ZH['Unavailable'] = u'不可用'
_AM_ZH['No route with your route settings.'] = u'当前航线设置下没有可用路线。'

_AM_ZH['Ammo'] = u'弹药'
_AM_ZH['Restock ammo when docked'] = u'停靠时补充弹药'
_AM_ZH['Refresh ammo storage'] = u'刷新弹药存储'
_AM_ZH['Search ammo...'] = u'搜索弹药...'
_AM_ZH['Loaded / Cargo / Cargo target (rounds). 0 means no restock. No ammo is bought.'] = u'已装填 / 货舱 / 货舱目标（发数）。0表示不补充。不会购买弹药。'
_AM_ZH['Loaded: %d | Cargo: %d'] = u'已装填：%d | 货舱：%d'
_AM_ZH['Dock to choose ammo storage.'] = u'停靠后选择弹药存储。'
_AM_ZH['Ammo source'] = u'弹药来源'

_AM_ZH["%s's fleet"] = u'%s的舰队'
_AM_ZH['%d/%d responders'] = u'%d/%d名增援'
_AM_ZH['Out of range: %d jumps (limit %d).'] = u'超出范围：%d跳（上限%d）。'
_AM_ZH['Joining the defense fleet.'] = u'正在加入防御舰队。'
_AM_ZH['Travelling to the defense fleet.'] = u'正在前往防御舰队。'
_AM_ZH['Warping to the defense fleet.'] = u'正在跃迁至防御舰队。'
_AM_ZH['Returning to the standby station.'] = u'正在返回待命空间站。'
_AM_ZH['PVE standby is ready.'] = u'PVE待命已就绪。'
_AM_ZH['Waiting for the selected public fleet anchor.'] = u'正在等待所选公共空间舰队锚点。'
_AM_ZH['Reinforcements requested.'] = u'已请求增援。'
_AM_ZH['Automatic reinforcements requested.'] = u'已自动请求增援。'
_AM_ZH['Reinforcements completed.'] = u'增援任务已完成。'
_AM_ZH['No reinforcement request.'] = u'没有增援请求。'
_AM_ZH['Choose a standby station before starting PVE.'] = u'启动PVE前请选择待命空间站。'
_AM_ZH['Choose an active public fleet and anchor for escort.'] = u'请选择活动的公共空间舰队和护航锚点。'
_AM_ZH['Selected route is outside the reinforcement range.'] = u'所选航线超出增援范围。'
_AM_ZH['Selected route is unavailable.'] = u'所选航线不可用。'

_AM_ZH['Reinforcements need an enabled fleet pilot in public space.'] = u'增援需要一名已启用的公共空间舰队驾驶员。'
_AM_ZH['Reinforcement queue is full.'] = u'增援队列已满。'
_AM_ZH['Defense fleet join is unavailable.'] = u'无法加入防御舰队。'
_AM_ZH['Defense fleet join timed out.'] = u'加入防御舰队超时。'
_AM_ZH['PVE deployment is no longer available.'] = u'PVE部署已不可用。'
_AM_ZH['PVE deployment no longer belongs to this pilot.'] = u'PVE部署已不属于此驾驶员。'
_AM_ZH['PVE standby destination is unavailable.'] = u'PVE待命目的地不可用。'
_AM_ZH['PVE docked outside its assigned destination.'] = u'PVE已停靠在分配的目的地之外。'
_AM_ZH['PVE route changed manually.'] = u'PVE航线被手动更改。'
_AM_ZH['PVE route made no progress.'] = u'PVE航线没有进展。'
_AM_ZH['PVE deployment interrupted; use Start / Resume to retry.'] = u'PVE部署已中断；点击启动 / 继续重试。'
_AM_ZH['Unknown PVE deployment action.'] = u'未知的PVE部署操作。'

_AM_ZH['PVE ammunition is ready.'] = u'PVE弹药已就绪。'
_AM_ZH['PVE ammunition needs compatible charges.'] = u'PVE需要兼容的弹药。'
_AM_ZH['Reloading PVE ammunition.'] = u'正在重新装填PVE弹药。'
_AM_ZH['PVE ammunition restock is incomplete.'] = u'PVE弹药补充未完成。'
_AM_ZH['PVE ammunition source is unavailable.'] = u'PVE弹药来源不可用。'
_AM_ZH['PVE ammunition transfer could not be confirmed.'] = u'无法确认PVE弹药转移。'

_AM_ZH['Invalid PVE ammunition targets.'] = u'PVE弹药目标无效。'
_AM_ZH['PVE ammunition source is short of stock.'] = u'PVE弹药来源库存不足。'
_AM_ZH['PVE ammunition cargo capacity reached.'] = u'PVE弹药货舱容量已满。'

_AM_ZH['Fleet coordination is managed by the PVE deployment.'] = u'舰队协调由PVE部署管理。'

_AM_ZH['Automatic reinforcement calls are unavailable.'] = u'自动呼叫增援不可用。'


# Escort orbit presentation and idle status.
_AM_ZH['Escort orbits the selected pilot while idle, switches to a rat in combat, then returns to the pilot.'] = u'护航舰在空闲时环绕所选驾驶员，战斗时转为环绕海盗，然后返回驾驶员身边。'
_AM_ZH['Automatic range follows your highest-DPS weapon, ammunition and skills.'] = u'自动距离根据每秒伤害最高的武器、弹药和技能计算。'
_AM_ZH['Automatic range: %.0f m | Orbit setting: %.0f m | Weapons: %d'] = u'自动距离：%.0f米 | 环绕设置：%.0f米 | 武器：%d'
_AM_ZH['Escorting the selected pilot.'] = u'正在护航所选驾驶员。'

_AM_ZH_PATTERNS = [
    (r'Armed - waiting for ore hold to reach (\d+)%.', u'已就绪：等待矿石舱达到 %s%%。'),
    (r'(\d+) mining drone\(s\) have orders\.', u'%s 架采矿无人机已收到指令。'),
    (r'Mining orders sent to (\d+) drone\(s\) \((spread|focus)\)\.', u'已向 %s 架无人机发送采矿指令（%s）。'),
    (r'Waiting (\d+)s after arrival before boosting\.', u'抵达后等待 %s 秒再启动增效。'),
    (r'(\d+) mining boost module\(s\) active\.', u'%s 个采矿增效模块运行中。'),
    (r'(\d+)/(\d+) mining boost module\(s\) active\.', u'%s/%s 个采矿增效模块运行中。'),
    (r'(\d+)/(\d+) nearby AutoMining pilot\(s\) in this fleet\.', u'附近 %s/%s 名 AutoMining 驾驶员已入队。'),
    (r'Rats detected; waiting for (\d+) mining drone\(s\) to return\.', u'发现海盗；等待 %s 架采矿无人机返回。'),
    (r'Rats gone; recalling (\d+) AutoMining fighter\(s\)\.', u'海盗已消失；正在召回 %s 架 AutoMining 战斗无人机。'),
    (r'Mining with (\d+) module\(s\)\.', u'正在使用 %s 个模块采矿。'),
    (r'Mining Surveyor refreshed; repeats every (\d+) seconds\.', u'采矿扫描器已刷新；每 %s 秒重复。'),
]


def _am_tr(source, *values):
    language = _am_language()
    catalogue = _AM_ZH if language == 'zh' else _AM_TRANSLATIONS.get(language, {})
    result = catalogue.get(source, source)
    if language != 'en':
        result = result.replace('AutoMining', _AM_NAMES[language])
    return result % values if values else result


def _am_status(value):
    result = unicode(value or '')
    language = _am_language()
    if language == 'en':
        return result
    catalogue = _AM_ZH if language == 'zh' else _AM_TRANSLATIONS.get(language, {})
    patterns = _AM_ZH_PATTERNS if language == 'zh' else _AM_PATTERN_TRANSLATIONS.get(language, ())
    # The server sends invariant English status text. Replace the bounded count
    # templates on the client, then any complete static sentences in the text.
    for pattern, translated in patterns:
        def substitute(match):
            values = tuple(_AM_MODE_NAMES.get(language, {}).get(part, part) for part in match.groups())
            return translated % values
        result = _am_re.sub(pattern, substitute, result)
    result = _am_re.sub(r'Activation interval must be between (\d+) and 86400 seconds\.',
                        lambda match: _am_tr('Activation interval must be between %s and 86400 seconds.', match.group(1)), result)
    result = _am_re.sub(r'AutoMining stopped for (\d+) fleet pilot\(s\)\.',
                        lambda match: _am_tr('AutoMining stopped for %d fleet pilot(s).', int(match.group(1))), result)
    for source in sorted(catalogue, key=len, reverse=True):
        if source.endswith(('.', '!', '?')) and '\n' not in source:
            result = result.replace(source, catalogue[source])
    for source in ('Mining boost waiting: ', 'activation refused', 'Jettison paused: ',
                   'Industrial shutdown waiting: ', 'Industrial activation waiting: ', 'Transport paused: ', 'Fleet pickup paused: ', 'Fleet coordination paused: ', 'Fleet ore reception paused: ', 'Fleet ore delivery paused: '):
        result = result.replace(source, catalogue.get(source, source))
    return result.replace('AutoMining', _AM_NAMES[language])


def _am_storage_label(value):
    result = unicode(value or '')
    if _am_language() == 'en':
        return result
    if result == 'Personal item hangar':
        return _am_tr(result)
    for prefix in ('Container: ', 'Corporation - '):
        if result.startswith(prefix):
            return _am_tr(prefix) + result[len(prefix):]
    return result

# Agency-style HUD presentation.
_AM_ZH.update({
    'Choose a job': u'\u9009\u62e9\u4efb\u52a1',
    'Patrol belts, escort fleets or answer reinforcement calls.': u'\u5de1\u903b\u5c0f\u884c\u661f\u5e26\u3001\u62a4\u822a\u8230\u961f\u6216\u54cd\u5e94\u589e\u63f4\u8bf7\u6c42\u3002',
    'Fleet and Defense appear after you choose a job. Statistics is always available.': u'\u9009\u62e9\u4efb\u52a1\u540e\u4f1a\u663e\u793a\u8230\u961f\u548c\u9632\u5fa1\u9875\u9762\u3002\u7edf\u8ba1\u59cb\u7ec8\u53ef\u7528\u3002',
    '%.2f m3 / unit': u'%.2f \u7acb\u65b9\u7c73 / \u5355\u4f4d',
})

_AM_ZH.update({
    'Unknown PVE error.': u'\u672a\u77e5 PVE \u9519\u8bef\u3002',
    'Click a resource to include it. Click it again to remove it.\nSelect an entry in Mining order to move it up or down.': u'\u70b9\u51fb\u8d44\u6e90\u53ef\u5c06\u5176\u52a0\u5165\u7b5b\u9009\uff0c\u518d\u6b21\u70b9\u51fb\u53ef\u79fb\u9664\u3002\n\u9009\u62e9\u5f00\u91c7\u987a\u5e8f\u4e2d\u7684\u6761\u76ee\uff0c\u5373\u53ef\u5c06\u5176\u4e0a\u79fb\u6216\u4e0b\u79fb\u3002',
})
