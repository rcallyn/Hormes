/**
 * `@hormes/install`: the one-Hormes install library, its own workspace package.
 * scripts/build-mac.ts imports it without dragging the brain, the hands and the
 * daemon in through `@hormes/cli`, and the engine imports it without depending on
 * the cli (which depends on the engine): no cycle in the workspace graph.
 */
export { parsePlistXml, serializePlistXml, PlistSyntaxError, dictGet, dictSet, dictOnly, stringAt, integerAt, str, int, dict, array } from "./plist.ts";
export type { PlistNode } from "./plist.ts";
export { HORMES_BUNDLE_ID, INSTALLED_APP, INSTALLED_URL, DEFAULT_FILE_TYPE, PIN_KEYS, findHormesTiles, isHormesTile, auditDock, modCountOf, describeDock, describeDockChanges, parseLsAppInfoList, helperTilesOf, describeHelperTiles, appExecutableOf } from "./dock.ts";
export type { DockTile, DockAudit, RunningApp } from "./dock.ts";
export { LSREGISTER, parseLsBundleDump, staleHormesRecords, hormesRecords, describeLaunchServices, defaultRealpath } from "./launchservices.ts";
export { probeTarget, planInstall, RSYNC, rsyncArgs, snapshotArgs, snapshotNameOk, parseItemized, compareTrees, parityOk, CODESIGN, CODESIGN_VERIFY_ARGS, CODESIGN_REQUIREMENT_ARGS, CODESIGN_AUTHORITY_ARGS, requirementHasIdentifier, checkRequirement, signingAuthority, installLine, rollbackLine, performInstall } from "./bundle.ts";
export type { TargetProbe, ParityReport, InstallIO, RequirementCheck } from "./bundle.ts";
export { runHygiene, readDock, readRunning, repairDock, restartDock, installedUrlOf, defaultExec, LSREGISTER_TIMEOUT_MS, LSAPPINFO } from "./hygiene.ts";
export type { Exec, ExecResult, HygieneReport } from "./hygiene.ts";
