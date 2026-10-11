import Foundation
import AppKit
import Carbon

// MARK: - Browser scripting through Apple events, without spawning osascript.
//
// `osascript` costs a process per call (30–60 ms before the script even runs). NSAppleScript
// compiles a script once and runs it in this process; with the JavaScript handed in as the
// `run` handler's argument the compiled script is reused across calls. Apple events must be
// sent from the main thread. Nothing here launches a browser: a browser that is not
// running answers `not_found`, so a doctor probe or a reflex never opens one.
//
// Chrome-family browsers expose `execute … javascript`; Safari `do JavaScript`. Both refuse
// until the user allows it (Chrome: View › Developer › Allow JavaScript from Apple Events;
// Safari: Develop › Allow JavaScript from Apple Events); that refusal comes back as
// `permission_denied` so the caller can fall back to the accessibility tree and shortcuts.

private let chromeFamily: Set<String> = ["google chrome", "google chrome canary", "chromium", "brave browser", "microsoft edge", "vivaldi", "arc", "opera"]
private let safariFamily: Set<String> = ["safari", "safari technology preview"]

enum BrowserKind {
    case chrome, safari

    init(app: String) throws {
        let key = app.lowercased()
        if chromeFamily.contains(key) { self = .chrome }
        else if safariFamily.contains(key) { self = .safari }
        else { throw HandsError.badRequest("'\(app)' is not a scriptable browser (Chrome family or Safari)") }
    }
}

private func appIsRunning(_ name: String) -> Bool {
    let wanted = name.lowercased()
    let running = onMain { NSWorkspace.shared.runningApplications }
    return running.contains { $0.localizedName?.lowercased() == wanted }
}

private func quoted(_ s: String) -> String {
    // AppleScript string literal: backslash and double quote escaped.
    return "\"" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
}

/// Compiled scripts by source, reused across calls (the JS rides in as an argument).
private var compiledScripts: [String: NSAppleScript] = [:]

private func compiled(_ source: String) throws -> NSAppleScript {
    if let s = compiledScripts[source] { return s }
    guard let script = NSAppleScript(source: source) else { throw HandsError.internalError("could not create the AppleScript") }
    var error: NSDictionary?
    guard script.compileAndReturnError(&error) else {
        throw HandsError.internalError("AppleScript did not compile: \((error?[NSAppleScript.errorMessage] as? String) ?? "unknown error")")
    }
    if compiledScripts.count > 32 { compiledScripts.removeAll() }
    compiledScripts[source] = script
    return script
}

/// Map an AppleScript failure to a hands error the caller can act on.
private func scriptError(_ error: NSDictionary?, app: String) -> HandsError {
    let message = (error?[NSAppleScript.errorMessage] as? String) ?? "AppleScript failed"
    let number = (error?[NSAppleScript.errorNumber] as? NSNumber)?.intValue ?? 0
    let lower = message.lowercased()
    if number == -1743 || lower.contains("not authorized") || lower.contains("not allowed assistive") {
        return .permissionDenied("Hormes is not allowed to control \(app): System Settings › Privacy & Security › Automation")
    }
    if lower.contains("turned off") || lower.contains("allow javascript") || lower.contains("javascript from apple events") || number == 8 {
        let path = (try? BrowserKind(app: app)) == .safari ? "Safari › Develop › Allow JavaScript from Apple Events" : "\(app) › View › Developer › Allow JavaScript from Apple Events"
        return .permissionDenied("JavaScript from Apple Events is off in \(app): turn on \(path)")
    }
    // -1728 errAENoSuchObject: no window, or a window without a web page (Safari's Start Page).
    if number == -1728 || lower.contains("can’t get") || lower.contains("can't get") || lower.contains("invalid index") {
        return .notFound("\(app) has no page open")
    }
    return .internalError("\(app): \(message) (\(number))")
}

/// Run a compiled script's `on run argv` with string arguments; returns the result descriptor.
private func runScript(_ source: String, arguments: [String], app: String) throws -> NSAppleEventDescriptor {
    return try onMain {
        let script = try compiled(source)
        let list = NSAppleEventDescriptor.list()
        for (i, arg) in arguments.enumerated() { list.insert(NSAppleEventDescriptor(string: arg), at: i + 1) }
        let target = NSAppleEventDescriptor(processIdentifier: ProcessInfo.processInfo.processIdentifier)
        let event = NSAppleEventDescriptor(eventClass: AEEventClass(kCoreEventClass), eventID: AEEventID(kAEOpenApplication), targetDescriptor: target, returnID: AEReturnID(kAutoGenerateReturnID), transactionID: AETransactionID(kAnyTransactionID))
        event.setParam(list, forKeyword: AEKeyword(keyDirectObject))
        var error: NSDictionary?
        let result = script.executeAppleEvent(event, error: &error)
        if let error { throw scriptError(error, app: app) }
        return result
    }
}

private func descriptorText(_ d: NSAppleEventDescriptor) -> String {
    if let s = d.stringValue { return s }
    if d.numberOfItems > 0 {
        return (1...d.numberOfItems).compactMap { d.atIndex($0).map(descriptorText) }.joined(separator: "\n")
    }
    if d.descriptorType == typeBoolean { return d.booleanValue ? "true" : "false" }
    return d.description
}

private func jsSource(_ kind: BrowserKind, app: String) -> String {
    switch kind {
    case .chrome:
        return """
        on run argv
            set js to item 1 of argv
            tell application \(quoted(app)) to return execute active tab of front window javascript js
        end run
        """
    case .safari:
        return """
        on run argv
            set js to item 1 of argv
            tell application \(quoted(app)) to return do JavaScript js in current tab of front window
        end run
        """
    }
}

/// Titles and URLs come back as two whole lists (two Apple events, not two per tab), joined
/// with a unit separator the browser never puts in a title.
private func tabsSource(_ kind: BrowserKind, app: String) -> String {
    let (activeExpr, titleProp) = kind == .chrome ? ("active tab index of w", "title") : ("index of current tab of w", "name")
    return """
    on run argv
        tell application \(quoted(app))
            if (count of windows) is 0 then return "0"
            set w to front window
            set tids to AppleScript's text item delimiters
            set AppleScript's text item delimiters to (ASCII character 31)
            set titles to (\(titleProp) of every tab of w) as text
            set urls to (URL of every tab of w) as text
            set AppleScript's text item delimiters to tids
            return ((\(activeExpr)) as text) & linefeed & titles & linefeed & urls
        end tell
    end run
    """
}

private func navigateSource(_ kind: BrowserKind, app: String) -> String {
    switch kind {
    case .chrome:
        return """
        on run argv
            set target to item 1 of argv
            tell application \(quoted(app))
                if (count of windows) is 0 then make new window
                set URL of active tab of front window to target
                return "ok"
            end tell
        end run
        """
    case .safari:
        return """
        on run argv
            set target to item 1 of argv
            tell application \(quoted(app))
                if (count of windows) is 0 then make new document
                set URL of current tab of front window to target
                return "ok"
            end tell
        end run
        """
    }
}

private func urlSource(_ kind: BrowserKind, app: String) -> String {
    switch kind {
    case .chrome:
        return """
        on run argv
            tell application \(quoted(app))
                if (count of windows) is 0 then return ""
                set t to active tab of front window
                return (URL of t) & linefeed & (title of t)
            end tell
        end run
        """
    case .safari:
        return """
        on run argv
            tell application \(quoted(app))
                if (count of windows) is 0 then return ""
                set t to current tab of front window
                return (URL of t) & linefeed & (name of t)
            end tell
        end run
        """
    }
}

/// Stable Chrome tab IDs are optional. Legacy general tools retain front-tab behavior.
private func targetArguments(_ params: Params, kind: BrowserKind) throws -> [String] {
    let window = try params.double("windowId"), tab = try params.double("tabId")
    guard window != nil || tab != nil else { return [] }
    guard kind == .chrome, let window, let tab, window > 0, tab > 0,
          window.rounded() == window, tab.rounded() == tab, window < 9.0e15, tab < 9.0e15 else {
        throw HandsError.badRequest("A stable browser target requires positive Chrome windowId and tabId integers")
    }
    return [String(Int(window)), String(Int(tab))]
}

private func targetSource(_ operation: String, app: String) -> String {
    let action: String
    switch operation {
    case "js": action = "return execute t javascript (item 1 of argv)"
    case "navigate": action = "set URL of t to (item 1 of argv)\nreturn \"ok\""
    default: action = "return (URL of t) & linefeed & (title of t)"
    }
    return """
    on run argv
        tell application \(quoted(app))
            set w to window id (item 2 of argv as integer)
            set t to tab id (item 3 of argv as integer) of w
            \(action)
        end tell
    end run
    """
}

private func shoppingTabsSource(app: String) -> String {
    return """
    on run argv
        tell application \(quoted(app))
            set rows to ""
            repeat with w in windows
                repeat with t in tabs of w
                    set rows to rows & (id of w as text) & (ASCII character 9) & (id of t as text) & (ASCII character 9) & (URL of t) & linefeed
                end repeat
            end repeat
            return rows
        end tell
    end run
    """
}

private func newTabSource(app: String) -> String {
    return """
    on run argv
        tell application \(quoted(app))
            if (count of windows) is 0 then make new window
            set w to front window
            set t to make new tab at end of tabs of w with properties {URL:(item 1 of argv)}
            return (id of w as text) & linefeed & (id of t as text)
        end tell
    end run
    """
}

private func requireRunning(_ app: String) throws -> BrowserKind {
    let kind = try BrowserKind(app: app)
    guard appIsRunning(app) else { throw HandsError.notFound("\(app) is not running") }
    return kind
}

/// Whether `app` is the front app, by name: a page script there lands where User's keys go.
private func isFrontApp(_ app: String) -> Bool {
    return frontmostNow()?.name.lowercased() == app.lowercased()
}

/// `browser_js {app, script, readOnly?}` → `{result}`: the script's result as text. In the front browser a page
/// script clicks, types and moves the focus under User's hands, so it is held like a click while he is using them;
/// behind another app it touches nothing of his and runs. `readOnly: true` (the client's probe, read and find, which
/// only look) runs in the front browser too.
func opBrowserJS(_ params: Params) throws -> JSONObject {
    let app = try params.requireString("app")
    let script = try params.requireString("script")
    let kind = try requireRunning(app)
    if try params.bool("readOnly") != true, isFrontApp(app) { try guardActing(params) }
    let start = DispatchTime.now()
    let target = try targetArguments(params, kind: kind)
    let result = try runScript(target.isEmpty ? jsSource(kind, app: app) : targetSource("js", app: app), arguments: [script] + target, app: app)
    return ["result": truncated(descriptorText(result), to: 60_000), "ms": elapsedMs(since: start)]
}

/// `browser_tabs {app}` → `{tabs: [{index, title, url, active}], active}` for the front window.
func opBrowserTabs(_ params: Params) throws -> JSONObject {
    let app = try params.requireString("app")
    let kind = try requireRunning(app)
    if try params.bool("allWindows") == true {
        guard kind == .chrome else { throw HandsError.badRequest("Stable shopping tab discovery requires a Chrome-family browser") }
        let text = descriptorText(try runScript(shoppingTabsSource(app: app), arguments: [], app: app))
        let tabs: [JSONObject] = text.split(separator: "\n").enumerated().compactMap { index, row in
            let fields = row.split(separator: "\t", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
            guard fields.count == 3, let window = Int(fields[0]), let tab = Int(fields[1]) else { return nil }
            return ["index": index + 1, "windowId": window, "tabId": tab, "url": fields[2], "title": "", "active": false]
        }
        return ["tabs": tabs, "active": 0]
    }
    let text = descriptorText(try runScript(tabsSource(kind, app: app), arguments: [], app: app))
    let lines = text.split(separator: "\n", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
    let active = Int(lines.first ?? "0") ?? 0
    guard lines.count == 3 else { return ["tabs": [], "active": active] }
    let sep = Character(UnicodeScalar(31))
    let titles = lines[1].split(separator: sep, omittingEmptySubsequences: false).map(String.init)
    let urls = lines[2].split(separator: sep, omittingEmptySubsequences: false).map(String.init)
    var tabs: [JSONObject] = []
    for (i, url) in urls.enumerated() {
        let index = i + 1
        tabs.append(["index": index, "title": i < titles.count ? titles[i] : "", "url": url, "active": index == active])
    }
    return ["tabs": tabs, "active": active]
}

/// `browser_navigate {app, url}` → `{ok: true}`; opens a window when the browser has none. It replaces the page
/// User may be typing in: held like a click while his hands are on the machine.
func opBrowserNavigate(_ params: Params) throws -> JSONObject {
    let app = try params.requireString("app")
    let url = try params.requireString("url")
    let kind = try requireRunning(app)
    let target = try targetArguments(params, kind: kind)
    let newTab = try params.bool("newTab") == true
    if newTab && (kind != .chrome || !target.isEmpty) { throw HandsError.badRequest("A new shopping tab requires Chrome and no existing target") }
    try guardActing(params)
    if newTab {
        let text = descriptorText(try runScript(newTabSource(app: app), arguments: [url], app: app))
        let fields = text.split(separator: "\n")
        guard fields.count == 2, let window = Int(fields[0]), let tab = Int(fields[1]) else { throw HandsError.internalError("The new browser tab did not return stable IDs") }
        return ["ok": true, "windowId": window, "tabId": tab]
    }
    _ = try runScript(target.isEmpty ? navigateSource(kind, app: app) : targetSource("navigate", app: app), arguments: [url] + target, app: app)
    return ["ok": true]
}

/// `browser_url {app}` → `{url, title}` of the active tab (needs no JavaScript permission).
func opBrowserURL(_ params: Params) throws -> JSONObject {
    let app = try params.requireString("app")
    let kind = try requireRunning(app)
    let target = try targetArguments(params, kind: kind)
    let text = descriptorText(try runScript(target.isEmpty ? urlSource(kind, app: app) : targetSource("url", app: app), arguments: target.isEmpty ? [] : [""] + target, app: app))
    let parts = text.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
    guard let url = parts.first, !url.isEmpty else { throw HandsError.notFound("\(app) has no window open") }
    return ["url": url, "title": parts.count > 1 ? parts[1] : ""]
}
