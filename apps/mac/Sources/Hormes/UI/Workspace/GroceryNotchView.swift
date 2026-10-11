import AppKit
import SwiftUI
import Combine

private struct GroceryNotchShape: Shape {
    let notchWidth: CGFloat
    func path(in rect: CGRect) -> Path {
        var path = Path(roundedRect: CGRect(x: 0, y: 34, width: rect.width, height: rect.height - 34), cornerRadius: 18)
        path.addRect(CGRect(x: rect.midX - notchWidth / 2, y: 0, width: notchWidth, height: 52))
        return path
    }
}

struct GroceryNotchView: View {
    let model: GroceryNotchPresentation
    let notchWidth: CGFloat
    let open: () -> Void
    // Official public favicon, https://www.instacart.com/favicon.ico, fetched 2026-10-11.
    private static let logo = NSImage(data: Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAACXBIWXMAACE4AAAhOAFFljFgAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAASYSURBVHgB7ZtPcts2FMY/QKJMKzMZ9gRFT9Bk112ZG9jjuJ2uap3AyrIrS7vubJ9A7qqduh6li66jG8Q3KG8QZWGZ+kfkQYoyimObBAGSUgY/j01rBhKBjw/vPeBBgMPhcFQHQwX4f/qC1/mRznuSenIR78cRSqaOKqhDgONE6z0zDOhvhJLhcDyKEygFJ1AKTqAUnEApOIFScAKl4ARKwThR9Pu+oCROLF7MEMW/lJ/tPtSfuZwPpz9Nr2FALoGCXhBMgskxErTpN/hkhw2g+U/zmjF2fnNwc4ESofvuSS6PWcLCVX84/XhXXkSXi8awcT5sDYfQRHuKqXXU+On4LQnToZfBFw0YnknI3u7V7ilK4kn/ySndt88kifMlQvV18nTyVvUdmmgJpCyHNdgbBibS2lKbdhkiKXFkItsZmgre4G/UGKCBlkD0FI6ziLPio0hZOp8L/8o/yijOCkFj0OqPlkA0dY6gCYl0kse001hsmYDnsdBfdRpnFijo0/QCE9AnYDusB8twj/dxnw9MR/j/+d9mbZxZoHgWP0NOlPO0OdWaV80TFQyQk/nN/JusbbNPsbrZZpWaat7fXu5Brfg4XTsoicwC+fC1c4g7BB73erpR5C4qisIQneQxs0DD/eFQSjmACTQtKIfS22pdQ02tnH7wE5LpjUEviknZhSEq9NOG/Y/QhHMewsLUms1mr3Ta13Qazy5nkXfo0RgRwgS5cLA+9AhhTnd8OP5L5w1aAimml9OBBZF0xbFBd3Qw6kATbYEUSqT6z/X3pNIPqGawOgwp2/7t9uXt78iBUeFQbS2wOevR6j3EBqKCiqzJlknB0UplVa2JVJ5jGmEsoqyme3t4ewZDrJWelTXxOe/QJ2qtdWxD68XXO3ynpdISWMB6bb5Ca4qSJGnFh/EAFrG+Jx0fxBe0s/eCHuUfKAla6503eOO5bXEWn40C8S/9kHFy4mACxVCI1axTyvGX5mWzo32aIwVlNV7N69jyNQ/eByWxSAmSbNu1jyJxPa1NW9N9s2pFVko/QGVgTdZCtw7VnDDTTDBtJHx5qUSgFRlSgkqsZp1KBVI8lGBWaTXrVC7QijVrCsgRt0YvR6/h+BxlTap6Aofjq6FSHyTbqoTDaft1Tld2Z2pJypCZSgYjdladoy5VINlW/kUVIDlFLLmH7JXRiLo6oOu/7Kxc512KQEthJsfqP+QrF68TLcVKumVYVqECWRbmHliHLMq4FPXoHVAQsq3KzHV1wECgWCK624uirKmQQ5zy1S5ZTV2ViAWKR9Bz/l+2izmHZF0g2W6eUCas1k5lJ3yni3tbxuoUW3ZQdlApdv2SNYFIHArbso+NgO3bSgesCLRM+FhZPicLlGTK5zYctyUfxNRZQYHNgfyfnWN/xgKR9RzRZQ+bR0h9C2GIBQti1iOHPcz7ZiTQ0jFv1NS6i7EVGVqQrLQOnw0zK8odxZbrrPE7bD4U0Xa+Y2f5CowGFjQJsR3QgxyFyImBQDLE1lALkRMTH/Q9tgeBnJhYkMD2kPthGgjEBLYHgZy4L/WmYPClXmltS8HhcDgc9/MBCfqJuJuJUBcAAAAASUVORK5CYII=")!)!
    var body: some View {
        Button(action: open) {
            HStack(spacing: 10) {
                HStack(spacing: 4) {
                    Image(nsImage: Self.logo).resizable().interpolation(.high).frame(width: 25, height: 25)
                    if model.isReady {
                        Image(systemName: "checkmark.circle.fill").font(.system(size: 15, weight: .semibold)).foregroundStyle(.green)
                    }
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(model.title).font(.system(size: 13, weight: .medium)).lineLimit(1).foregroundStyle(.white)
                    Text(model.detail).font(.system(size: 10)).foregroundStyle(.white.opacity(0.58)).lineLimit(1)
                }
                Spacer(minLength: 6)
                if model.isWorking { ProgressView().controlSize(.small).tint(.white) }
                else if !model.isReady { Image(systemName: "exclamationmark.circle").foregroundStyle(.white.opacity(0.7)) }
                else { Image(systemName: "arrow.up.right").font(.system(size: 11)).foregroundStyle(.white.opacity(0.6)) }
            }.padding(.horizontal, 16).frame(height: 58).padding(.top, 34)
                .contentShape(Rectangle())
        }.buttonStyle(.plain)
            .background(GroceryNotchShape(notchWidth: notchWidth).fill(.black))
            .help("External computer-use rehearsal. " + model.detail + ". Nothing purchased.")
            .accessibilityLabel(model.title + ". " + model.detail + ". External computer-use rehearsal. Nothing purchased.")
    }
}

private final class GroceryStatusPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// Local explicit rehearsal feed. No daemon command, model tool or engine receipt is created.
@MainActor final class GroceryNotchController {
    static let notification = Notification.Name("studio.hormes.external-cart-rehearsal.v1")
    private let state: AppState
    private let panel = GroceryStatusPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    private var observer: NSObjectProtocol?
    private var timer: AnyCancellable?
    private var model: GroceryNotchPresentation?

    init(state: AppState) {
        self.state = state
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = true
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        observer = DistributedNotificationCenter.default().addObserver(forName: Self.notification, object: "explicit-rehearsal", queue: .main) { [weak self] notification in
            guard let payload = notification.userInfo?["payload"] as? String, payload.utf8.count <= 8192,
                  let data = payload.data(using: .utf8), let event = try? JSONDecoder().decode(GroceryNotchEvent.self, from: data) else { return }
            Task { @MainActor [weak self] in self?.receive(event) }
        }
        timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect().sink { [weak self] _ in self?.expire() }
    }
    private func receive(_ event: GroceryNotchEvent) {
        let now = Date().timeIntervalSince1970 * 1000
        if event.phase == "clear", event.source == "external-computer-use", event.rehearsal,
           event.version == 1, abs(now - event.at) <= 15_000, event.runId == model?.runId,
           event.taskId == model?.taskId, event.sessionId == model?.sessionId { clear(); return }
        guard let next = GroceryNotchPresentation.transition(event, previous: model, work: state.work, now: now) else { return }
        model = next; show(next)
    }
    private func show(_ model: GroceryNotchPresentation) {
        guard let screen = NSScreen.main else { return }
        let geometry = NotchGeometry.current(), bounds = geometry?.screen ?? screen.frame
        let width: CGFloat = 360, height: CGFloat = 92, center = geometry?.notch.midX ?? bounds.midX
        panel.contentView = NSHostingView(rootView: GroceryNotchView(model: model, notchWidth: geometry?.notch.width ?? 220) { [weak self] in
            guard let current = self?.model, current.isReady, Date().timeIntervalSince1970 * 1000 < current.expiresAt,
                  let url = current.reviewURL else { return }
            NSWorkspace.shared.open(url)
        })
        let rect = NSRect(x: center - width / 2, y: bounds.maxY - height, width: width, height: height)
        if !panel.isVisible { panel.setFrame(NSRect(x: center - 110, y: bounds.maxY - 34, width: 220, height: 34), display: false) }
        panel.orderFront(nil)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.22
            panel.animator().setFrame(rect, display: true)
        }
    }
    private func expire() {
        guard let current = model else { return }
        let now = Date().timeIntervalSince1970 * 1000
        let validTask = state.work.tasks?.contains(where: { $0.id == current.taskId && $0.sessionId == current.sessionId && $0.supersededAt == nil }) == true
        if !validTask || state.work.quiet || !state.connected { clear(); return }
        if now >= current.expiresAt { clear() }
    }
    private func clear() { model = nil; panel.orderOut(nil) }
}
