"use strict";
const fs=require("node:fs"), path=require("node:path"), os=require("node:os"), crypto=require("node:crypto");
const {spawnSync}=require("node:child_process");
const {patchPyj,hash}=require("./client/patch");
const {surveySeconds}=require("./lib/settings");
const ENTRY="eve/client/script/ui/eveCommands.pyj";
function powershell(script,env={}) {
  const result=spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",`$ErrorActionPreference='Stop'; ${script}`],{
    windowsHide:true,encoding:"utf8",env:{...process.env,...env},maxBuffer:1024*1024,
  });
  if(result.error || result.status!==0)throw Error((result.stderr||result.error?.message||"Client archive operation failed").trim());
  return result.stdout.trim();
}
function readEntry(archive,out) {
  powershell("Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($env:AUTOMINING_ARCHIVE); try { $e=$z.GetEntry($env:AUTOMINING_ENTRY); if (!$e) { throw 'EVE command module not found' }; $s=$e.Open(); $f=[IO.File]::Create($env:AUTOMINING_DATA); try {$s.CopyTo($f)} finally {$f.Dispose();$s.Dispose()} } finally {$z.Dispose()}",{
    AUTOMINING_ARCHIVE:archive,AUTOMINING_ENTRY:ENTRY,AUTOMINING_DATA:out,
  });
  return fs.readFileSync(out);
}
function replaceEntry(archive,input) {
  powershell("Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::Open($env:AUTOMINING_ARCHIVE,[IO.Compression.ZipArchiveMode]::Update); try {$old=$z.GetEntry($env:AUTOMINING_ENTRY); if (!$old) {throw 'EVE command module not found'}; $old.Delete(); [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z,$env:AUTOMINING_DATA,$env:AUTOMINING_ENTRY,[IO.Compression.CompressionLevel]::Optimal) | Out-Null} finally {$z.Dispose()}",{
    AUTOMINING_ARCHIVE:archive,AUTOMINING_ENTRY:ENTRY,AUTOMINING_DATA:input,
  });
}
function ensureStopped(clientRoot) {
  powershell("$p=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'exefile.exe' -and (!$_.ExecutablePath -or $_.ExecutablePath.StartsWith($env:AUTOMINING_CLIENT,[StringComparison]::OrdinalIgnoreCase))}); if($p.Count){throw 'Close EVE clients using this client installation before applying AutoMining client changes.'}",{AUTOMINING_CLIENT:clientRoot+path.sep});
}
function writeJSON(file,value) {
  const temporary=file+".tmp";
  fs.writeFileSync(temporary,JSON.stringify(value,null,2)+"\n");
  fs.renameSync(temporary,file);
}
function recoverSwap(clientRoot,state,archive,receiptFile) {
  const journal=path.join(state,"pending.json");
  if(!fs.existsSync(journal))return;
  ensureStopped(clientRoot);
  const p=JSON.parse(fs.readFileSync(journal,"utf8"));
  if(p.clientRoot!==clientRoot || path.dirname(p.backup)!==state || !/^code\.ccp\.(before|disabled)-\d+$/.test(path.basename(p.backup)))throw Error("Unrecognized AutoMining recovery record");
  const current=fs.existsSync(archive)?hash(fs.readFileSync(archive)):null;
  if(current===p.afterHash)writeJSON(receiptFile,p.receipt);
  else if(current!==p.beforeHash) {
    if(current || !fs.existsSync(p.backup) || hash(fs.readFileSync(p.backup))!==p.beforeHash)throw Error("Client archive changed during an interrupted operation. Preserve files for recovery.");
    fs.renameSync(p.backup,archive);
  }
  fs.unlinkSync(journal);
}
function commitSwap(clientRoot,state,archive,stage,backup,beforeHash,receiptFile,receipt) {
  const journal=path.join(state,"pending.json");
  writeJSON(journal,{clientRoot,backup,beforeHash,afterHash:hash(fs.readFileSync(stage)),receipt});
  fs.renameSync(archive,backup);
  try {fs.renameSync(stage,archive);} catch(error) {fs.renameSync(backup,archive);fs.unlinkSync(journal);throw error;}
  writeJSON(receiptFile,receipt);
  fs.unlinkSync(journal);
}
function execute(request) {
  const clientRoot=fs.realpathSync(request.runtime.clientRoot);
  const archive=path.join(clientRoot,"code.ccp");
  const modRoot=fs.realpathSync(request.mod.path);
  // Physical client state belongs outside the replaceable mod package. Both
  // backups and receipts survive package updates and are shared across roots.
  const state=path.join(clientRoot,".automining");
  const receiptFile=path.join(state,"receipt.json");
  if(fs.existsSync(path.join(state,"pending.json"))) {
    if(!["recover","install","prepare_disable","prepare_remove"].includes(request.action))throw Error("AutoMining installation was interrupted. Close the client and use Actions > Recover.");
    recoverSwap(clientRoot,state,archive,receiptFile);
  }
  const receipt=fs.existsSync(receiptFile)?JSON.parse(fs.readFileSync(receiptFile,"utf8")):null;
  if(receipt && receipt.clientRoot!==clientRoot)throw Error("Client receipt belongs to another installation");
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),"automining-client-"));
  // Scratch files are retained on failure for diagnosis; successful actions only
  // delete explicitly named regular files inside this freshly-created directory.
  const entryFile=path.join(scratch,"entry.pyj");
  const current=readEntry(archive,entryFile);
  const currentHash=hash(current);
  const isActive=receipt?.status==="active" && receipt.installedEntryHash===currentHash;
  const reply={protocol:request.protocol,requestId:request.requestId,success:true,state:"ready",message:"",restartRequired:[],contributions:[],environment:{},arguments:[]};
  if(request.action==="prepare_profile" || request.action==="verify") {
    if(!isActive)throw Error("AutoMining client companion is missing or changed. Close EVE, then use AutoMining Actions > Install / Update.");
    if(request.action==="prepare_profile") {
      const p=request.settings?.profile || {};
      const prefs={apply:p.apply===true,ores:String(p.ores||""),order:p.order||"nearest",approach:p.approach===true,compress:p.compress===true,lock:p.lock!==false,survey:p.survey===true,surveySeconds:surveySeconds(p.surveySeconds)};
      const settingsFile=request.profile?.modDataRoot && path.join(request.profile.modDataRoot,"preferences.json");
      const stored=settingsFile && fs.existsSync(settingsFile)?JSON.parse(fs.readFileSync(settingsFile,"utf8").replace(/^\uFEFF/,"")):{};
      prefs.surveyDefaulted=!Object.prototype.hasOwnProperty.call(stored,"survey");
      reply.environment.AUTOMINING_PROFILE_SETTINGS=JSON.stringify(prefs);
    }
    reply.message="AutoMining client companion verified.";
  } else if(request.action==="install" || request.action==="recover") {
    const source=require("./lib/clientSource").buildClientSource(modRoot);
    const sourceHash=hash(Buffer.from(source));
    if(isActive && receipt.companionHash===sourceHash) reply.message="AutoMining client companion is already installed.";
    else {
      ensureStopped(clientRoot);
      if(receipt?.status==="active" && !isActive)throw Error("Client command module changed after installation; refusing to overwrite it.");
      const original=isActive?fs.readFileSync(path.join(state,"original.pyj")):current;
      if(isActive && hash(original)!==receipt.originalEntryHash)throw Error("Original client module backup is invalid");
      const patched=patchPyj(original,source);
      fs.mkdirSync(state,{recursive:true});
      if(!isActive)fs.writeFileSync(path.join(state,"original.pyj"),original);
      const beforeArchiveHash=hash(fs.readFileSync(archive));
      const stage=path.join(clientRoot,`code.ccp.automining-stage-${crypto.randomUUID()}`);
      fs.copyFileSync(archive,stage);
      const patchedFile=path.join(scratch,"patched.pyj");fs.writeFileSync(patchedFile,patched);
      replaceEntry(stage,patchedFile);
      if(hash(readEntry(stage,path.join(scratch,"check.pyj")))!==hash(patched))throw Error("Staged client verification failed");
      ensureStopped(clientRoot);
      if(hash(fs.readFileSync(archive))!==beforeArchiveHash)throw Error("Client archive changed while preparing the patch");
      const backup=path.join(state,`code.ccp.before-${Date.now()}`);
      commitSwap(clientRoot,state,archive,stage,backup,beforeArchiveHash,receiptFile,{status:"active",clientRoot,originalEntryHash:hash(original),installedEntryHash:hash(patched),companionHash:sourceHash,backup});
      reply.message="AutoMining client companion installed. Start clients through the Launcher.";
      reply.restartRequired=["client"];
    }
  } else if(request.action==="prepare_disable" || request.action==="prepare_remove") {
    if(!receipt || receipt.status==="restored")reply.message="AutoMining client companion already restored.";
    else {
      ensureStopped(clientRoot);
      if(!isActive)throw Error("Client command module changed; refusing unsafe restoration.");
      const original=fs.readFileSync(path.join(state,"original.pyj"));
      if(hash(original)!==receipt.originalEntryHash)throw Error("Client module backup is invalid");
      const stage=path.join(clientRoot,`code.ccp.automining-stage-${crypto.randomUUID()}`);
      const before=hash(fs.readFileSync(archive));fs.copyFileSync(archive,stage);
      const restoreFile=path.join(scratch,"restore.pyj");fs.writeFileSync(restoreFile,original);
      replaceEntry(stage,restoreFile);
      if(hash(readEntry(stage,path.join(scratch,"check.pyj")))!==receipt.originalEntryHash)throw Error("Restoration verification failed");
      ensureStopped(clientRoot);
      if(hash(fs.readFileSync(archive))!==before)throw Error("Client archive changed during restoration");
      const backup=path.join(state,`code.ccp.disabled-${Date.now()}`);
      commitSwap(clientRoot,state,archive,stage,backup,before,receiptFile,{...receipt,status:"restored"});
      reply.message="Original client command module restored; unrelated archive entries preserved.";reply.restartRequired=["client"];
    }
  } else throw Error("Unsupported AutoMining helper action");
  for(const name of ["entry.pyj","patched.pyj","check.pyj","restore.pyj"]) {
    const file=path.join(scratch,name);if(fs.existsSync(file))fs.unlinkSync(file);
  }
  fs.rmdirSync(scratch);
  return reply;
}
if(require.main===module) {
  const arg=name=>process.argv[process.argv.indexOf(name)+1];
  const request=JSON.parse(fs.readFileSync(arg("--request"),"utf8"));
  let result;
  try {result=execute(request);} catch(error) {result={protocol:request.protocol,requestId:request.requestId,success:false,state:"failed",message:String(error.message).replace(/[\x00-\x20\x7f]+/g," ").slice(0,4000),restartRequired:[],contributions:[],environment:{},arguments:[]};}
  fs.writeFileSync(arg("--result"),JSON.stringify(result));
  if(!result.success)process.exitCode=1;
}
module.exports={execute,readEntry,replaceEntry,recoverSwap};
