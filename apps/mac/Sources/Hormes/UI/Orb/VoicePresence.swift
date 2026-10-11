import AppKit
import QuartzCore

struct RGB: Equatable {
    var r: Double, g: Double, b: Double

    init(_ r: Double, _ g: Double, _ b: Double) { self.r = r; self.g = g; self.b = b }

    init(hex: UInt32) {
        r = Double((hex >> 16) & 0xff) / 255
        g = Double((hex >> 8) & 0xff) / 255
        b = Double(hex & 0xff) / 255
    }

    func mixed(with other: RGB, _ t: Double) -> RGB {
        let k = min(max(t, 0), 1)
        return RGB(r + (other.r - r) * k, g + (other.g - g) * k, b + (other.b - b) * k)
    }

    func cgColor(alpha: Double = 1) -> CGColor { CGColor(srgbRed: r, green: g, blue: b, alpha: alpha) }
    var cgColor: CGColor { cgColor(alpha: 1) }
}

/// Monochrome presence. Motion and opacity distinguish activity without coloured halos.
enum OrbPalette {
    static let ground = RGB(hex: 0x000000)
    static let text = RGB(hex: 0xffffff)
    static let listening = RGB(hex: 0xffffff)
    static let speaking = RGB(hex: 0xffffff)
    static let thinking = RGB(hex: 0xd9d9d9)
    static let acting = RGB(hex: 0xffffff)
    static let error = RGB(hex: 0xffffff)
    static let asleep = RGB(hex: 0x707070)
    static let muted = RGB(hex: 0x707070)
    static let titanium = RGB(hex: 0x808080)
    static let connecting = RGB(hex: 0xa6a6a6)
    static let accentLight = RGB(hex: 0x000000)
    static let accentDark = RGB(hex: 0xffffff)
    static func accent(dark: Bool) -> RGB { dark ? accentDark : accentLight }

    /// The overlay's tone colours (OverlayPainter's, one for one), for the blob on a
    /// trace: the pen is the colour of the line it draws.
    static func tone(_ t: OverlayTone) -> RGB {
        switch t {
        case .accent: return accentDark
        case .ok: return acting
        case .warn: return error
        case .mark: return speaking
        }
    }

    static func color(for phase: Phase) -> RGB {
        switch phase {
        case .asleep: return asleep
        case .connecting: return connecting
        case .listening: return listening
        case .speaking: return speaking
        case .thinking: return thinking
        case .acting: return acting
        case .muted: return muted
        case .paused: return titanium
        case .error: return error
        }
    }
}

/// What the wake word gate is doing, as far as the blob cares. Only read while the
/// phase is asleep: awake, the phase personality owns the field.
enum BlobGate: Equatable {
    case off, listening, heard, authenticating, granted, denied, lockedOut

    init(_ s: WakeGateState) {
        switch s {
        case .off: self = .off
        case .listening: self = .listening
        case .heard: self = .heard
        case .authenticating: self = .authenticating
        case .granted: self = .granted
        case .denied: self = .denied
        case .lockedOut: self = .lockedOut
        }
    }
}

enum BadNumber {
    nonisolated(unsafe) private static var seen = Set<String>()
    private static let lock = NSLock()
    /// Log the first bad number at `site`; later ones at the same site are silent.
    nonisolated static func noteOnce(_ site: String, _ detail: @autoclosure () -> String = "") {
        lock.lock()
        let first = seen.insert(site).inserted
        lock.unlock()
        guard first else { return }
        let d = detail()
        NSLog("Hormes: non-finite number at %@%@ — made safe (logged once per site)", site, d.isEmpty ? "" : ": \(d)")
    }
}

extension CGPoint { var isFinitePoint: Bool { x.isFinite && y.isFinite } }
extension CGVector { var isFiniteVector: Bool { dx.isFinite && dy.isFinite } }
extension CGRect { var isFiniteRect: Bool { origin.isFinitePoint && size.width.isFinite && size.height.isFinite } }

/// 0…1, and 0 for a NaN or ±inf. `min(1, max(0, x))` hands a NaN on unchanged —
/// `0 >= nan` is false, so `max` keeps the NaN — which is how one bad level would
/// reach every eased value; this never does.
@inline(__always) func finite01(_ x: Double) -> Double { x.isFinite ? min(1, max(0, x)) : 0 }
@inline(__always) func finite01(_ x: CGFloat) -> CGFloat { x.isFinite ? min(1, max(0, x)) : 0 }

/// Audio and phase state for the five-bar presence. Movement belongs to the panel's
/// spatial controller; no mascot geometry, glyph field, face or halo is simulated.
final class VoiceAnimation {
    private(set) var phase: Phase = .asleep
    private(set) var gate: BlobGate = .off
    var reducedMotion = false
    private var rawInput = 0.0, rawOutput = 0.0
    private var input = 0.0, output = 0.0
    private(set) var time = 0.0
    private var changedAt = 0.0
    private var cue = 0.0

    func setPhase(_ value: Phase) {
        guard value != phase else { return }
        phase = value
        signal()
    }
    func setGate(_ value: BlobGate) {
        guard value != gate else { return }
        gate = value
        signal()
    }
    func setLevels(_ levels: AudioLevels) {
        rawInput = finite01(levels.input)
        rawOutput = finite01(levels.output)
    }
    func signal() { changedAt = time; cue = 1 }
    func step(_ elapsed: Double) {
        guard elapsed.isFinite, elapsed > 0 else { return }
        let dt = min(elapsed, 0.2)
        time += dt
        let smoothing = 1 - exp(-dt * 20)
        input += (rawInput - input) * smoothing
        output += (rawOutput - output) * smoothing
        cue *= exp(-dt * 7)
    }
    var islandLevel: Double { max(input, output) }
    var rawLevelsActive: Bool { rawInput > 0.02 || rawOutput > 0.02 }
    var displayColor: RGB { OrbPalette.color(for: phase) }
    var desiredFPS: Double { rawLevelsActive ? 24 : 10 }
    /// A slow, staggered breath keeps the quiet logo alive on both surfaces.
    /// Audio takes over smoothly; Reduce Motion leaves the bars at rest.
    func barScale(at index: Int) -> Double {
        guard !reducedMotion else { return 1 }
        let level = finite01(islandLevel)
        let idle = sin(time * (2 * .pi / 4.8) - Double(index) * 0.45) * 0.12
        let voice = sin(time * 5 + Double(index) * 0.7) * level * 0.25
        return 1 + idle * (1 - level) + voice
    }
    var isStatic: Bool {
        if !reducedMotion { return false }
        guard !rawLevelsActive, islandLevel < 0.02, cue < 0.02 else { return false }
        switch phase {
        case .asleep, .paused, .muted, .error: return time - changedAt > 1.5
        default: return reducedMotion
        }
    }

}


@MainActor
final class VoicePresenceView: NSView {
    let sim: VoiceAnimation
    private var link: CADisplayLink?
    private var lastRender = 0.0
    private var lastSimStep = 0.0
    private var idleSince = -1.0
    private var linkRate = 0.0
    /// Set while the panel is ordered out: no ticks at all.
    var paused = false {
        didSet {
            guard paused != oldValue else { return }
            if paused { link?.isPaused = true; lastSimStep = 0 } else { poke() }
        }
    }

    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        sim = VoiceAnimation()
        super.init(frame: frame)
        wantsLayer = true
        layerContentsRedrawPolicy = .onSetNeedsDisplay
        setAccessibilityElement(true)
        setAccessibilityRole(.image)
    }

    required init?(coder: NSCoder) { fatalError("VoicePresenceView is code-only") }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        syncAppearance()
        guard window != nil, link == nil else { return }
        let l = displayLink(target: self, selector: #selector(onFrame(_:)))
        l.add(to: .main, forMode: .common)
        link = l
        poke()
    }

    /// The accent follows the appearance like the capsule's does; the colour eases over.
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        syncAppearance()
    }

    private func syncAppearance() { poke() }

    /// A phase or level changed: resume drawing if needed.
    func poke() {
        idleSince = -1
        guard !paused, let link else { return }
        if link.isPaused { lastSimStep = 0; link.isPaused = false }
    }

    private func frame(now: Double) -> Bool {
        if lastSimStep == 0 { lastSimStep = now; lastRender = 0 }
        if now - lastRender >= 1 / sim.desiredFPS - 0.002 {
            sim.step(now - lastSimStep)
            lastSimStep = now
            lastRender = now
            needsDisplay = true
        }
        return !sim.isStatic
    }

    @objc private func onFrame(_ link: CADisplayLink) {
        let now = CACurrentMediaTime()
        let wants = frame(now: now)
        let wantRate = max(10, min(30, sim.desiredFPS))
        if wantRate != linkRate {
            linkRate = wantRate
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 10, maximum: 30, preferred: Float(wantRate))
        }

        if wants {
            idleSince = -1
        } else if idleSince < 0 {
            idleSince = now
        } else if now - idleSince > 0.5 {
            link.isPaused = true
            lastSimStep = 0
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let cg = NSGraphicsContext.current?.cgContext else { return }
        let width = min(bounds.width * 0.66, 72.0), height = min(bounds.height * 0.58, 48.0)
        let rect = CGRect(x: bounds.midX - width / 2, y: bounds.midY - height / 2, width: width, height: height)
        cg.saveGState()
        cg.setFillColor(CGColor(gray: 0, alpha: 0.97))
        cg.addPath(CGPath(roundedRect: rect, cornerWidth: 14, cornerHeight: 14, transform: nil)); cg.fillPath()
        let unit = width / 16
        for (index, base) in [0.3, 0.55, 0.85, 0.55, 0.3].enumerated() {
            let h = height * 0.64 * CGFloat(base * sim.barScale(at: index))
            let bar = CGRect(x: rect.midX + CGFloat(index - 2) * unit * 2.2 - unit / 2,
                             y: rect.midY - h / 2, width: unit, height: h)
            cg.setFillColor(CGColor(gray: 1, alpha: sim.phase == .asleep ? 0.72 : 1))
            cg.addPath(CGPath(roundedRect: bar, cornerWidth: unit / 2, cornerHeight: unit / 2, transform: nil)); cg.fillPath()
        }
        cg.restoreGState()
    }

    override func accessibilityLabel() -> String? {
        if sim.phase == .asleep, sim.gate != .off { return "Hormes, asleep, wake word \(sim.gate)" }
        return "Hormes, \(sim.phase.rawValue)"
    }
}

