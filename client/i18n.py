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
    'Container: ': u'货柜：', 'Corporation - ': u'军团 - ',
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
    ' (group)': u'（编组）', 'base': u'基础',
    'Available ore / ice / gas (%s)': u'可用矿石 / 冰矿 / 气云（%s）',
    'Mining order: top first (%s)': u'采矿顺序：顶部优先（%s）',
    'Priority: entry 1 first, then entry 2': u'优先级：先第 1 项，再第 2 项',
    'Search area: ': u'搜索范围：', 'whole current belt': u'当前整片矿带',
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
    'Could not load drone groups: ': u'无法载入无人机编组：',
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
    for source in sorted(catalogue, key=len, reverse=True):
        if source.endswith(('.', '!', '?')) and '\n' not in source:
            result = result.replace(source, catalogue[source])
    for source in ('Mining boost waiting: ', 'activation refused'):
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
