import Foundation
import AVFoundation

/// Offline calibration: features only are kept in the fixture, never microphone audio.
enum ClapRecordingChecks {
    private struct Recording: Decodable {
        var name: String
        var claps: [Double]
        var frames: [ClapDetector.Frame]
    }

    private static func detections(_ frames: [ClapDetector.Frame]) -> [Double] {
        var detector = ClapDetector()
        return frames.compactMap { detector.feed($0) ? $0.at : nil }
    }

    static func extractor() {
        let samples: [Float] = (0..<4800).map { Float(sin(Double($0) * 0.27) * 0.2) }
        func extract(blockSize: Int, interleaved: Bool = false) -> [ClapDetector.Frame] {
            let pcm = interleaved ? samples.flatMap { [$0, Float(0.8)] } : samples
            var extractor = ClapFrameExtractor(), frames: [ClapDetector.Frame] = []
            pcm.withUnsafeBufferPointer { buffer in
                for offset in Swift.stride(from: 0, to: samples.count, by: blockSize) {
                    frames += extractor.frames(samples: buffer.baseAddress! + offset * (interleaved ? 2 : 1),
                        count: min(blockSize, samples.count - offset), sampleRate: 48000,
                        stride: interleaved ? 2 : 1, at: Double(offset) / 48000)
                }
            }
            return frames
        }
        let whole = extract(blockSize: samples.count)
        check(whole.count == 10 && whole.allSatisfy { abs($0.duration - 0.01) < 1e-12 }, "feature windows stay exactly 10 ms")
        for blockSize in [32, 512, 1024, 4096] {
            for interleaved in [false, true] {
                let pieces = extract(blockSize: blockSize, interleaved: interleaved)
                let equal = pieces.count == whole.count && zip(pieces, whole).allSatisfy {
                    abs($0.at - $1.at) < 1e-12 && $0.rms == $1.rms && $0.peak == $1.peak && $0.highFrequency == $1.highFrequency
                }
                check(equal, "features ignore buffer boundaries (\(blockSize), interleaved \(interleaved))")
            }
        }
        var extractor = ClapFrameExtractor()
        samples.withUnsafeBufferPointer { pcm in
            _ = extractor.frames(samples: pcm.baseAddress!, count: 200, sampleRate: 48000, at: 0)
            let afterGap = extractor.frames(samples: pcm.baseAddress! + 200, count: 480, sampleRate: 48000, at: 1)
            check(afterGap.count == 1 && afterGap[0].at == 1, "a capture gap drops partial feature windows")
            let newRate = extractor.frames(samples: pcm.baseAddress!, count: 160, sampleRate: 16000, at: 2)
            check(newRate.count == 1 && newRate[0].duration == 0.01, "microphone rate changes reset partial windows")
        }
    }

    static func fixtures() {
        do {
            let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
                .appendingPathComponent("fixtures/clap-recordings.json")
            let recordings = try JSONDecoder().decode([Recording].self, from: Data(contentsOf: url))
            for recording in recordings {
                for gain in [1.0, 0.5, 0.25] {
                    let frames = recording.frames.map { f -> ClapDetector.Frame in
                        var f = f; f.rms *= gain; f.peak *= gain; return f
                    }
                    let hits = detections(frames)
                    check(hits.count == 1 && hits[0] >= recording.claps[1] - 0.15 && hits[0] <= recording.claps[1] + 0.10,
                          "\(recording.name) detected once at gain \(gain)", "\(hits)")
                }
                // Keep all the recording's incidental sound but remove each clap in turn.
                for removed in [0, 1] {
                    let midpoint = (recording.claps[0] + recording.claps[1]) / 2
                    let frames = recording.frames.map { f -> ClapDetector.Frame in
                        var f = f
                        if f.at >= recording.claps[0] && f.at <= recording.claps[1]
                            && (removed == 0 ? f.at < midpoint : f.at >= midpoint) {
                            f.rms = 0.001; f.peak = 0.002; f.highFrequency = 0.001
                        }
                        return f
                    }
                    check(detections(frames).isEmpty, "\(recording.name) with clap \(removed + 1) removed stays quiet")
                }
            }
        } catch { check(false, "load recorded clap features", "\(error)") }
    }

    /// Optional original-file verification through the exact production extractor.
    static func audio(at path: String) {
        do {
            let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
            guard file.length > 0, Double(file.length) / file.processingFormat.sampleRate <= 60,
                  let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)) else {
                check(false, "recording must contain at most 60 seconds of audio"); return
            }
            try file.read(into: buffer)
            guard let channel = buffer.floatChannelData?[0] else { check(false, "recording has float PCM"); return }
            let rate = buffer.format.sampleRate, count = Int(buffer.frameLength)
            let stride = buffer.format.isInterleaved ? Int(buffer.format.channelCount) : 1
            let name = URL(fileURLWithPath: path).lastPathComponent
            for blockSize in [512, 1024, 4096] {
                for gain: Float in [1, 0.5, 0.25] {
                    for shiftMS in [0, 3, 7] {
                        let lead = Int(rate * Double(shiftMS) / 1000)
                        let samples = Array(repeating: Float(0), count: lead) + (0..<count).map { channel[$0 * stride] * gain }
                        var frames: [ClapDetector.Frame] = []
                        var extractor = ClapFrameExtractor()
                        samples.withUnsafeBufferPointer { pcm in
                            for offset in Swift.stride(from: 0, to: samples.count, by: blockSize) {
                                frames += extractor.frames(samples: pcm.baseAddress! + offset,
                                    count: min(blockSize, samples.count - offset), sampleRate: rate, at: Double(offset) / rate)
                            }
                        }
                        let hits = detections(frames)
                        check(hits.count == 1, "\(name), \(blockSize)-sample buffers, gain \(gain), shift \(shiftMS) ms: exactly one double clap", "\(hits)")
                        if hits.count == 1 { print(String(format: "  detected at %.3f s", hits[0])) }
                    }
                }
            }
        } catch { check(false, "decode supplied clap recording", "\(error)") }
    }
}
