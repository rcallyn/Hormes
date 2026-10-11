import SwiftUI
import VisionKit

@main
struct HormesPhoneApp: App {
    @StateObject private var store = ReviewStore.shared
    @Environment(\.scenePhase) private var phase
    init() { ReviewStore.shared.startDelivery() }
    var body: some Scene {
        WindowGroup {
            PhoneReviewView().environmentObject(store)
                .preferredColorScheme(.dark)
                .onOpenURL { url in
                    if url.host == "pair" { Task { await store.pair(url) } }
                }
                .task {
                    #if DEBUG
                    if ProcessInfo.processInfo.arguments.contains("--reset-demo") { try? store.resetDemo() }
                    if ProcessInfo.processInfo.arguments.contains("--demo-review") {
                        if !store.cache.reviews.contains(where: { $0.id == "phone_demo" }) { try? store.accept(Self.demo) }
                        try? store.select("phone_demo")
                    }
                    #endif
                    await store.updateActivity(startIfNeeded: true)
                    if store.paired { await store.refresh() }
                }
                .onChange(of: phase) { _, new in
                    if new == .active {
                        Task {
                            await store.updateActivity(startIfNeeded: true)
                            if store.paired { await store.refresh() }
                        }
                    }
                }
        }
    }
    #if DEBUG
    static let demo = PhoneQuiz(version: 1, id: "phone_demo", sessionId: "demo_class_review", deckId: "demo_deck", title: "Microeconomics", demo: true, issuedAt: 0, goalVersion: 1, cards: [
        QuizCard(id: "demo_1", front: "What does opportunity cost measure?", options: ["Best forgone alternative", "All money spent", "Only fixed costs", "Total revenue"], correctOption: 0, explanation: "Opportunity cost is the value of the best alternative you give up."),
        QuizCard(id: "demo_2", front: "A budget constraint describes…", options: ["Affordable combinations", "All desired goods", "Market supply", "Producer profit"], correctOption: 0, explanation: "It describes combinations affordable at current prices and income."),
        QuizCard(id: "demo_3", front: "With income fixed, a price rise usually…", options: ["Shrinks purchasing power", "Raises income", "Lowers all prices", "Removes scarcity"], correctOption: 0, explanation: "The same income buys less of the good whose price rose."),
        QuizCard(id: "demo_4", front: "At market clearing…", options: ["Demand equals supply", "Prices are always zero", "Everyone buys equally", "Income is identical"], correctOption: 0, explanation: "Aggregate demand and supply match for the market under consideration.")
    ], answers: [], limitation: "Synthetic rehearsal questions. These are separate from your learning records.")
    #endif
}

enum PhoneTheme {
    static let background = Color(red: 0.045, green: 0.045, blue: 0.05)
    static let line = Color.white.opacity(0.10)
    static let muted = Color.white.opacity(0.48)
    static func eyebrow(_ text: String) -> some View {
        Text(text.uppercased()).font(.system(size: 10, weight: .medium)).tracking(1.7).foregroundStyle(muted)
    }
}

struct PhoneReviewView: View {
    @EnvironmentObject private var store: ReviewStore
    @State private var scan = false
    @State private var pairingText = ""
    @State private var showPairing = false
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 30) {
                    if let review = store.current { reviewBody(review) }
                    else {
                        VStack(alignment: .leading, spacing: 20) {
                            PhoneTheme.eyebrow("Between classes")
                            Text("Keep the lesson going.").font(.system(size: 32, weight: .semibold)).tracking(-0.8)
                            Text(store.paired ? "Your next class review will appear here and in Dynamic Island." : "Pair your Mac once. Bring your class reviews with you.")
                                .font(.system(size: 16)).foregroundStyle(.secondary).lineSpacing(4)
                            if !store.paired {
                                Button { showPairing = true } label: { Label("Pair with Mac", systemImage: "qrcode.viewfinder").frame(maxWidth: .infinity, minHeight: 36) }
                                    .buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black).clipShape(RoundedRectangle(cornerRadius: 12))
                            }
                        }.padding(.vertical, 28)
                    }
                    syncStatus
                    if store.cache.reviews.count > 1 {
                        VStack(alignment: .leading, spacing: 14) {
                            PhoneTheme.eyebrow("Saved reviews")
                            ForEach(store.cache.reviews.reversed()) { review in
                                Button {
                                    do { try store.select(review.id); Task { await store.updateActivity(startIfNeeded: true) } }
                                    catch { store.message = error.localizedDescription }
                                } label: {
                                    HStack(spacing: 12) {
                                        Image(systemName: review.current == nil ? "checkmark.circle" : "circle").font(.system(size: 15)).foregroundStyle(PhoneTheme.muted)
                                        Text(review.quiz.title).font(.system(size: 15)).frame(maxWidth: .infinity, alignment: .leading)
                                        Text("\(review.completed)/\(review.quiz.cards.count)").font(.system(size: 12, design: .monospaced)).foregroundStyle(PhoneTheme.muted)
                                        Image(systemName: "chevron.right").font(.system(size: 10)).foregroundStyle(PhoneTheme.muted)
                                    }.padding(.vertical, 12).contentShape(Rectangle())
                                }.buttonStyle(.plain)
                                Rectangle().fill(PhoneTheme.line).frame(height: 0.5)
                            }
                        }
                    }
                }.padding(.horizontal, 24).padding(.top, 22).padding(.bottom, 32)
                    .frame(maxWidth: 580, alignment: .leading).frame(maxWidth: .infinity)
            }
            .background(PhoneTheme.background)
            .navigationTitle("Hormes").navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(PhoneTheme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showPairing = true } label: { Image(systemName: "gearshape").font(.system(size: 17)) }
                        .accessibilityLabel("Connection settings")
                }
            }
            .refreshable { if store.paired { await store.refresh() } }
            .sheet(isPresented: $showPairing) { pairingSheet }
            .sheet(isPresented: $scan) {
                PairingScanner { value in scan = false; showPairing = false; if let url = URL(string: value) { Task { await store.pair(url) } } }
                    .ignoresSafeArea()
            }
        }.tint(.white)
    }
    @ViewBuilder private func reviewBody(_ review: CachedReview) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    PhoneTheme.eyebrow("Between classes")
                    Spacer()
                    if review.quiz.demo { Text("DEMO").font(.system(size: 9, weight: .medium, design: .monospaced)).foregroundStyle(PhoneTheme.muted) }
                }
                Text(review.quiz.title).font(.system(size: 32, weight: .semibold)).tracking(-0.8)
                HStack(spacing: 12) {
                    ProgressView(value: Double(review.completed), total: Double(review.quiz.cards.count)).tint(.white)
                    Text("\(review.completed) / \(review.quiz.cards.count)").font(.system(size: 11, design: .monospaced)).foregroundStyle(PhoneTheme.muted).fixedSize()
                }
            }
            Rectangle().fill(PhoneTheme.line).frame(height: 0.5)
            if let card = review.current {
                VStack(alignment: .leading, spacing: 16) {
                    PhoneTheme.eyebrow("Question \(review.cursor + 1)")
                    Text(card.front).font(.system(size: 24, weight: .medium)).tracking(-0.35).lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("quiz-question")
                }
                VStack(spacing: 0) {
                    ForEach(Array(card.options.enumerated()), id: \.offset) { index, option in
                        Button {
                            do {
                                try store.answer(quizId: review.id, cardId: card.id, choice: index)
                                Task { await store.updateActivity(startIfNeeded: true); if store.paired { try? await store.synchronize() } }
                            } catch { store.message = error.localizedDescription }
                        } label: {
                            HStack(spacing: 16) {
                                Text(String(UnicodeScalar(65 + index)!)).font(.system(size: 12, weight: .medium, design: .monospaced)).foregroundStyle(PhoneTheme.muted).frame(width: 18)
                                Text(option).font(.system(size: 16)).frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
                                Image(systemName: review.selected?.submission.choiceIndex == index ? "checkmark.circle.fill" : "circle")
                                    .font(.system(size: 18)).foregroundStyle(review.selected?.submission.choiceIndex == index ? Color.white : PhoneTheme.muted.opacity(0.55))
                            }.padding(.horizontal, 12).padding(.vertical, 18).frame(minHeight: 60)
                                .background(review.selected?.submission.choiceIndex == index ? Color.white.opacity(0.08) : .clear, in: RoundedRectangle(cornerRadius: 10))
                                .contentShape(Rectangle())
                        }.buttonStyle(.plain).disabled(review.selected != nil).accessibilityIdentifier("answer-\(index)")
                        if index < card.options.count - 1 { Rectangle().fill(PhoneTheme.line).frame(height: 0.5).padding(.leading, 46) }
                    }
                }
                if let selected = review.selected {
                    VStack(alignment: .leading, spacing: 10) {
                        Label(selected.submission.choiceIndex == card.correctOption ? "Correct" : "Review this one", systemImage: selected.submission.choiceIndex == card.correctOption ? "checkmark.circle" : "arrow.counterclockwise")
                            .font(.system(size: 14, weight: .medium))
                        Text(card.explanation).font(.system(size: 15)).foregroundStyle(.secondary).lineSpacing(3)
                        if let error = selected.error { Text(error).font(.footnote).foregroundStyle(.orange) }
                    }
                    Button {
                        do { try store.advance(quizId: review.id, cardId: card.id); Task { await store.updateActivity() } }
                        catch { store.message = error.localizedDescription }
                    } label: {
                        HStack { Text(review.cursor + 1 == review.quiz.cards.count ? "Finish review" : "Next question"); Spacer(); Image(systemName: "arrow.right") }
                            .font(.system(size: 15, weight: .medium)).padding(.horizontal, 6).frame(minHeight: 34)
                    }.buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black).clipShape(RoundedRectangle(cornerRadius: 12)).accessibilityIdentifier("next-question")
                } else {
                    if store.islandActive { Label("Ready in Dynamic Island", systemImage: "capsule").font(.system(size: 11)).foregroundStyle(PhoneTheme.muted) }
                }
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    Label("Review complete", systemImage: "checkmark.circle").font(.system(size: 24, weight: .medium))
                    Text("A little practice, carried forward.").font(.system(size: 16)).foregroundStyle(.secondary)
                }.padding(.vertical, 20)
            }
        }
    }
    private var syncStatus: some View {
        VStack(alignment: .leading, spacing: 8) {
            Rectangle().fill(PhoneTheme.line).frame(height: 0.5).padding(.bottom, 10)
            HStack(spacing: 6) {
                Image(systemName: store.pendingCount > 0 ? "iphone" : "checkmark.icloud").font(.system(size: 11))
                Text(store.pendingCount > 0 ? "\(store.pendingCount) answers saved on iPhone" : store.paired ? "Paired with your Mac" : "Saved on this iPhone")
                    .font(.system(size: 11, weight: .medium))
            }.foregroundStyle(PhoneTheme.muted)
            if let message = store.message { Text(message).font(.system(size: 11)).foregroundStyle(PhoneTheme.muted).accessibilityIdentifier("sync-status") }
        }
    }
    private var pairingSheet: some View {
        NavigationStack {
            Form {
                Section("Your Mac") {
                    if store.paired {
                        Label("Mac paired", systemImage: "checkmark.circle")
                        Button("Sync saved answers") { Task { await store.refresh() } }.disabled(store.busy)
                    } else {
                        Text("On your Mac, open Hormes Console → Settings → iPhone. Show the QR code with both devices on the same Wi-Fi.").font(.subheadline).foregroundStyle(.secondary)
                        Button { showPairing = false; DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { scan = true } } label: { Label("Scan Mac QR code", systemImage: "qrcode.viewfinder") }
                    }
                }
                Section("Dynamic Island") {
                    Label(store.automaticDeliveryReady ? "Automatic delivery is ready" : "New reviews appear automatically", systemImage: "capsule")
                    Text("Set up automatic delivery once in Mac Settings. When a class review is ready, it appears in Dynamic Island. Hold the island to answer; you can stay in the app you’re using.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("Pairing link") {
                    TextField("Paste a pairing link", text: $pairingText).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Pair with Mac") { if let url = URL(string: pairingText) { showPairing = false; Task { await store.pair(url) } } }.disabled(pairingText.isEmpty || store.busy)
                }
                if store.paired { Section { Button("Disconnect from Mac", role: .destructive) { Task { await store.disconnect(); showPairing = false } } } }
                Section { Text("Downloaded reviews work offline. Saved answers sync when you reconnect to your Mac.").font(.footnote).foregroundStyle(.secondary) }
            }.navigationTitle("Connection").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showPairing = false } } }
        }.tint(.white).presentationDragIndicator(.visible)
    }
}

struct PairingScanner: UIViewControllerRepresentable {
    let found: (String) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(found: found) }
    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced, recognizesMultipleItems: false, isGuidanceEnabled: true, isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }
    func updateUIViewController(_ uiViewController: DataScannerViewController, context: Context) {}
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let found: (String) -> Void
        var delivered = false
        init(found: @escaping (String) -> Void) { self.found = found }
        func dataScanner(_ scanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            for case .barcode(let barcode) in addedItems {
                guard !delivered, let value = barcode.payloadStringValue, value.hasPrefix("hormes://pair?") else { continue }
                delivered = true; scanner.stopScanning(); found(value)
            }
        }
    }
}
