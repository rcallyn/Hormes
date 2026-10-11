import Foundation

/// Small local signal detector. It identifies two short, sharp transients; it is
/// intentionally not an identity check and cannot distinguish a replayed clap.
struct ClapDetector {
    struct Frame: Codable {
        var at: Double
        var duration: Double
        var rms: Double
        var peak: Double
        var highFrequency: Double
        var crest: Double { peak / max(rms, 0.000001) }
    }
    private var noise = 0.001
    private var previousRMS = 0.001
    private struct Pulse {
        var at: Double
        var end: Double
        var strongestRMS: Double
        var needsFastDecay: Bool
    }
    private var pulse: Pulse?
    private var first: Double?
    private var quietUntil = 0.0
    private var cooldownUntil = 0.0
    private var lastAt = -Double.infinity
    private var warmupUntil: Double?

    mutating func reset() { self = ClapDetector() }

    mutating func feed(_ f: Frame) -> Bool {
        guard f.at.isFinite, f.duration > 0, f.duration <= 0.04,
              f.rms.isFinite, f.rms >= 0, f.peak.isFinite, f.peak >= f.rms,
              f.highFrequency.isFinite, f.highFrequency >= 0 else { reset(); return false }
        if f.at < lastAt || f.at - lastAt > 0.25 { reset() }
        lastAt = f.at
        if warmupUntil == nil { warmupUntil = f.at + 0.35 }
        let threshold = max(0.014, noise * 7)
        // A microphone or AAC recording can soften a clap's high frequencies and
        // lower its crest. Keep the original broadband route, but admit those
        // filtered impulses only with a stronger rise and an immediate decay.
        let broadband = f.crest >= 2.7 && f.highFrequency >= 0.18
        let filtered = f.crest >= 2.2 && f.highFrequency >= 0.004
            && f.rms >= previousRMS * 4
        let sharp = f.rms >= threshold && ((broadband && f.peak >= 0.065) || (filtered && f.peak >= 0.06))
        let onset = sharp && f.rms >= max(0.006, previousRMS * 2.8)
        defer { previousRMS = f.rms }
        if let first, f.at - first > 0.75 { self.first = nil }
        if var p = pulse {
            p.strongestRMS = max(p.strongestRMS, f.rms)
            if p.needsFastDecay, f.at - p.at >= 0.04, f.rms > p.strongestRMS * 0.35 {
                pulse = nil; first = nil; quietUntil = f.at + 0.12
                return false
            }
            if f.rms > max(0.006, noise * 3) {
                p.end = f.at + f.duration; pulse = p
                if p.end - p.at > 0.10 { pulse = nil; first = nil; quietUntil = f.at + 0.12 }
                return false
            }
            pulse = nil
            quietUntil = f.at + 0.075
            guard p.end - p.at <= 0.10 else { first = nil; return false }
            if let a = first, p.at - a >= 0.18, p.at - a <= 0.70 {
                first = nil; cooldownUntil = f.at + 4
                return true
            }
            first = p.at
            return false
        }
        if f.at >= (warmupUntil ?? .infinity), f.at >= cooldownUntil, f.at >= quietUntil, onset {
            pulse = Pulse(at: f.at, end: f.at + f.duration, strongestRMS: f.rms, needsFastDecay: !broadband)
        } else if f.rms < threshold {
            noise = max(0.0002, min(0.008, noise * 0.98 + f.rms * 0.02))
        }
        return false
    }
}

/// The live tap and offline recording checks use identical 10 ms signal features.
/// Timestamps refer to audio samples, so callback scheduling cannot split a pair.
struct ClapFrameExtractor {
    private var sampleRate = 0.0
    private var pending = 0
    private var squares = 0.0, difference = 0.0, peak = 0.0, prior = 0.0
    private var windowAt = 0.0
    private var nextAt: Double?

    mutating func frames(samples: UnsafePointer<Float>, count: Int, sampleRate rate: Double,
                         stride: Int = 1, at: Double) -> [ClapDetector.Frame] {
        guard rate.isFinite, rate > 0, count > 0, stride > 0, at.isFinite else { return [] }
        if sampleRate != rate || nextAt.map({ abs(at - $0) > 1.5 / rate }) == true {
            self = ClapFrameExtractor()
        }
        sampleRate = rate
        nextAt = at + Double(count) / rate
        let window = max(1, Int(rate * 0.01))
        var frames: [ClapDetector.Frame] = []
        frames.reserveCapacity((count + pending) / window)
        for i in 0..<count {
            if pending == 0 { windowAt = at + Double(i) / rate }
            let value = Double(samples[i * stride])
            squares += value * value
            peak = max(peak, abs(value))
            if pending > 0 { difference += (value - prior) * (value - prior) }
            prior = value
            pending += 1
            if pending == window {
                frames.append(.init(at: windowAt, duration: Double(window) / rate,
                    rms: sqrt(squares / Double(window)), peak: peak,
                    highFrequency: difference / max(squares, 0.0000001)))
                pending = 0; squares = 0; difference = 0; peak = 0; prior = 0
            }
        }
        return frames
    }
}

/// All detector state lives on this serial queue; only the result reaches main.
final class ClapSignalProcessor: @unchecked Sendable {
    private let queue = DispatchQueue(label: "hormes.wake.claps")
    private var detector = ClapDetector()
    func reset() { queue.async { self.detector.reset() } }
    func feed(_ frames: [ClapDetector.Frame], detected: @escaping @Sendable () -> Void) {
        queue.async {
            for frame in frames where self.detector.feed(frame) {
                DispatchQueue.main.async(execute: detected)
            }
        }
    }
}

enum WakeGesturePolicy {
    static func acceptsClap(trigger: WakeTrigger, enabled: Bool, listening: Bool,
                            quiet: Bool, unlocked: Bool, audioEnabled: Bool) -> Bool {
        trigger != .word && enabled && listening && quiet && unlocked && audioEnabled
    }
    static func forwardsWords(trigger: WakeTrigger, authenticating: Bool) -> Bool {
        trigger != .clap || authenticating
    }
}
