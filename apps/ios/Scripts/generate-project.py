#!/usr/bin/env python3
"""Generate the small iOS Xcode project using only Python's standard library."""
import hashlib
import json
import plistlib
from pathlib import Path

root = Path(__file__).resolve().parents[1]
project = root / 'HormesPhone.xcodeproj'
project.mkdir(exist_ok=True)
objects = {}
def ident(name): return hashlib.sha256(name.encode()).hexdigest()[:24].upper()
def add(name, value):
    key = ident(name)
    objects[key] = value
    return key
class Ref(str): pass
def ref(value): return Ref(value)
def render(value, indent=0):
    if isinstance(value, Ref): return str(value)
    if isinstance(value, dict):
        return '{\n' + '\n'.join('\t'*(indent+1) + json.dumps(str(k)) + ' = ' + render(v, indent+1) + ';' for k,v in value.items()) + '\n' + '\t'*indent + '}'
    if isinstance(value, list): return '(' + ', '.join(render(v, indent) for v in value) + ')'
    if isinstance(value, int): return str(value)
    return json.dumps(str(value))

app_files = ['HormesPhone/HormesPhoneApp.swift', 'HormesPhone/PhoneConnection.swift', 'HormesPhone/ReviewStore.swift', 'HormesPhone/PhoneDelivery.swift', 'Shared/ReviewModels.swift', 'Shared/ReviewIntents.swift']
widget_files = ['HormesReviewWidget/HormesReviewWidget.swift', 'Shared/ReviewModels.swift', 'Shared/ReviewIntents.swift']
test_files = ['HormesPhoneTests/ReviewStoreTests.swift']
ui_files = ['HormesPhoneUITests/PhoneFlowTests.swift']
file_refs = {p: add('file:'+p, {'isa':'PBXFileReference','lastKnownFileType':'sourcecode.swift','path':p,'sourceTree':'<group>'}) for p in sorted(set(app_files+widget_files+test_files+ui_files))}
products = {}
for target, extension, kind in [('HormesPhone','app','wrapper.application'),('HormesReviewWidget','appex','wrapper.app-extension'),('HormesPhoneTests','xctest','wrapper.cfbundle'),('HormesPhoneUITests','xctest','wrapper.cfbundle')]:
    products[target] = add('product:'+target, {'isa':'PBXFileReference','explicitFileType':kind,'includeInIndex':0,'path':target+'.'+extension,'sourceTree':'BUILT_PRODUCTS_DIR'})
product_group = add('products',{'isa':'PBXGroup','children':[ref(p) for p in products.values()],'name':'Products','sourceTree':'<group>'})
assets = add('assets',{'isa':'PBXFileReference','lastKnownFileType':'folder.assetcatalog','path':'HormesPhone/Assets.xcassets','sourceTree':'<group>'})
group = add('group',{'isa':'PBXGroup','children':[ref(v) for v in file_refs.values()]+[ref(assets),ref(product_group)],'sourceTree':'<group>'})

def configs(name, overrides):
    refs=[]
    for mode in ['Debug','Release']:
        settings={'ALWAYS_SEARCH_USER_PATHS':'NO','SWIFT_VERSION':'5.0','IPHONEOS_DEPLOYMENT_TARGET':'17.0','SDKROOT':'iphoneos','TARGETED_DEVICE_FAMILY':'1,2','CODE_SIGN_STYLE':'Automatic','SWIFT_OPTIMIZATION_LEVEL':'-Onone' if mode=='Debug' else '-O','SWIFT_ACTIVE_COMPILATION_CONDITIONS':'DEBUG' if mode=='Debug' else '', 'ENABLE_TESTABILITY':'YES' if mode=='Debug' else 'NO'}
        settings.update(overrides)
        if name=='HormesPhone': settings['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] += ' HORMES_PHONE_APP'
        refs.append(ref(add(name+':'+mode,{'isa':'XCBuildConfiguration','buildSettings':settings,'name':mode})))
    return add(name+':configs',{'isa':'XCConfigurationList','buildConfigurations':refs,'defaultConfigurationIsVisible':0,'defaultConfigurationName':'Release'})

app_id=ident('target:HormesPhone'); widget_id=ident('target:HormesReviewWidget')
for name,files,kind in [('HormesPhone',app_files,'com.apple.product-type.application'),('HormesReviewWidget',widget_files,'com.apple.product-type.app-extension'),('HormesPhoneTests',test_files,'com.apple.product-type.bundle.unit-test'),('HormesPhoneUITests',ui_files,'com.apple.product-type.bundle.ui-testing')]:
    source_files=[ref(add('build:'+name+':'+p,{'isa':'PBXBuildFile','fileRef':ref(file_refs[p])})) for p in files]
    sources=add('sources:'+name,{'isa':'PBXSourcesBuildPhase','buildActionMask':2147483647,'files':source_files,'runOnlyForDeploymentPostprocessing':0})
    frameworks=add('frameworks:'+name,{'isa':'PBXFrameworksBuildPhase','buildActionMask':2147483647,'files':[],'runOnlyForDeploymentPostprocessing':0})
    phases=[ref(sources),ref(frameworks)]; dependencies=[]
    settings={'PRODUCT_NAME':'$(TARGET_NAME)','PRODUCT_BUNDLE_IDENTIFIER':{'HormesPhone':'com.hormes.phone','HormesReviewWidget':'com.hormes.phone.review','HormesPhoneTests':'com.hormes.phone.tests','HormesPhoneUITests':'com.hormes.phone.uitests'}[name],'INFOPLIST_FILE':name+'/Info.plist','CURRENT_PROJECT_VERSION':'1','MARKETING_VERSION':'1.0','LD_RUNPATH_SEARCH_PATHS':['$(inherited)','@executable_path/Frameworks']}
    if name=='HormesPhone':
        settings['CODE_SIGN_ENTITLEMENTS'] = 'HormesPhone/HormesPhone.entitlements'
        settings['ASSETCATALOG_COMPILER_APPICON_NAME'] = 'AppIcon'
        asset_file=add('assetBuild',{'isa':'PBXBuildFile','fileRef':ref(assets)})
        phases.append(ref(add('resources',{'isa':'PBXResourcesBuildPhase','buildActionMask':2147483647,'files':[ref(asset_file)],'runOnlyForDeploymentPostprocessing':0})))
        embed_file=add('embedFile',{'isa':'PBXBuildFile','fileRef':ref(products['HormesReviewWidget']),'settings':{'ATTRIBUTES':['RemoveHeadersOnCopy']}})
        phases.append(ref(add('embed',{'isa':'PBXCopyFilesBuildPhase','buildActionMask':2147483647,'dstPath':'','dstSubfolderSpec':13,'files':[ref(embed_file)],'name':'Embed App Extensions','runOnlyForDeploymentPostprocessing':0})))
        dependencies.append(ref(add('widgetDependency',{'isa':'PBXTargetDependency','target':ref(widget_id)})))
    if name=='HormesReviewWidget': settings.update({'APPLICATION_EXTENSION_API_ONLY':'YES','SKIP_INSTALL':'YES','LD_RUNPATH_SEARCH_PATHS':['$(inherited)','@executable_path/Frameworks','@executable_path/../../Frameworks']})
    if name=='HormesPhoneTests':
        settings.update({'TEST_HOST':'$(BUILT_PRODUCTS_DIR)/HormesPhone.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/HormesPhone','BUNDLE_LOADER':'$(TEST_HOST)','GENERATE_INFOPLIST_FILE':'YES'})
        settings.pop('INFOPLIST_FILE')
        dependencies.append(ref(add('testDependency',{'isa':'PBXTargetDependency','target':ref(app_id)})))
    if name=='HormesPhoneUITests':
        settings.update({'TEST_TARGET_NAME':'HormesPhone','GENERATE_INFOPLIST_FILE':'YES'})
        settings.pop('INFOPLIST_FILE')
        dependencies.append(ref(add('uiDependency',{'isa':'PBXTargetDependency','target':ref(app_id)})))
    add('target:'+name,{'isa':'PBXNativeTarget','buildConfigurationList':ref(configs(name,settings)),'buildPhases':phases,'buildRules':[],'dependencies':dependencies,'name':name,'productName':name,'productReference':ref(products[name]),'productType':kind})
project_id=add('project',{'isa':'PBXProject','attributes':{'LastUpgradeCheck':'2700','BuildIndependentTargetsInParallel':'YES'},'buildConfigurationList':ref(configs('Project',{})),'compatibilityVersion':'Xcode 14.0','developmentRegion':'en','hasScannedForEncodings':0,'knownRegions':['en','Base'],'mainGroup':ref(group),'productRefGroup':ref(product_group),'projectDirPath':'','projectRoot':'','targets':[ref(ident('target:'+x)) for x in products]})
(project/'project.pbxproj').write_text('// !$*UTF8*$!\n'+render({'archiveVersion':1,'classes':{},'objectVersion':56,'objects':objects,'rootObject':ref(project_id)})+'\n')
for name in ['HormesPhone','HormesReviewWidget']:
    info={'CFBundleDevelopmentRegion':'$(DEVELOPMENT_LANGUAGE)','CFBundleExecutable':'$(EXECUTABLE_NAME)','CFBundleIdentifier':'$(PRODUCT_BUNDLE_IDENTIFIER)','CFBundleInfoDictionaryVersion':'6.0','CFBundleName':'$(PRODUCT_NAME)','CFBundlePackageType':'APPL' if name=='HormesPhone' else 'XPC!','CFBundleShortVersionString':'$(MARKETING_VERSION)','CFBundleVersion':'$(CURRENT_PROJECT_VERSION)'}
    if name=='HormesPhone':
        info.update({'CFBundleDisplayName':'Hormes','LSRequiresIPhoneOS':True,'NSSupportsLiveActivities':True,'UIBackgroundModes':['remote-notification'],'NSCameraUsageDescription':'Scan the pairing QR code shown by Hormes on your Mac.','NSLocalNetworkUsageDescription':'Download lecture reviews from your paired Mac and sync saved answers.','NSAppTransportSecurity':{'NSAllowsLocalNetworking':True},'CFBundleURLTypes':[{'CFBundleURLName':'com.hormes.phone','CFBundleURLSchemes':['hormes']}],'UIApplicationSceneManifest':{'UIApplicationSupportsMultipleScenes':False},'UILaunchScreen':{},'UISupportedInterfaceOrientations':['UIInterfaceOrientationPortrait'],'UISupportedInterfaceOrientations~ipad':['UIInterfaceOrientationPortrait','UIInterfaceOrientationLandscapeLeft','UIInterfaceOrientationLandscapeRight']})
    else: info['NSExtension']={'NSExtensionPointIdentifier':'com.apple.widgetkit-extension'}
    (root/name/'Info.plist').write_bytes(plistlib.dumps(info))
(root/'HormesPhone/HormesPhone.entitlements').write_bytes(plistlib.dumps({'aps-environment':'development'}))
schemes=project/'xcshareddata/xcschemes'; schemes.mkdir(parents=True,exist_ok=True)
def build_ref(name): return '<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="'+ident('target:'+name)+'" BuildableName="'+name+('.app' if name=='HormesPhone' else '.xctest')+'" BlueprintName="'+name+'" ReferencedContainer="container:HormesPhone.xcodeproj"/>'
(schemes/'HormesPhone.xcscheme').write_text('''<?xml version="1.0" encoding="UTF-8"?><Scheme LastUpgradeVersion="2700" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">'''+build_ref('HormesPhone')+'''</BuildActionEntry></BuildActionEntries></BuildAction><TestAction buildConfiguration="Debug" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">'''+build_ref('HormesPhoneTests')+'''</TestableReference><TestableReference skipped="NO">'''+build_ref('HormesPhoneUITests')+'''</TestableReference></Testables></TestAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">'''+build_ref('HormesPhone')+'''</BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release"/><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>''')
