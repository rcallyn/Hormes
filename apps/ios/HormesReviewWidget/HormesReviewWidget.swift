import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@main
struct HormesReviewWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ReviewActivityAttributes.self) { context in
            VStack(alignment: .leading, spacing: 12) {
                HStack { Label(context.state.title, systemImage: "graduationcap"); Spacer(); progress(context.state) }.font(.caption.weight(.medium))
                question(context, island: false)
            }.padding(16).activityBackgroundTint(.black).activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        Image(systemName: "graduationcap")
                        Text(context.state.demo ? "Demo · \(context.state.title)" : context.state.title).lineLimit(1)
                    }.font(.system(size: 10, weight: .medium)).foregroundStyle(.white.opacity(0.6))
                }
                DynamicIslandExpandedRegion(.trailing) { progress(context.state).font(.caption.monospacedDigit()) }
                DynamicIslandExpandedRegion(.bottom) { question(context, island: true) }
            } compactLeading: {
                Image(systemName: "graduationcap").accessibilityLabel("Hormes review")
            } compactTrailing: {
                progress(context.state).font(.caption2.monospacedDigit())
            } minimal: {
                Image(systemName: "graduationcap")
            }
            .widgetURL(URL(string: "hormes://review"))
            .keylineTint(.white)
        }
    }
    private func progress(_ state: ReviewActivityAttributes.ContentState) -> some View {
        Text("\(state.completed)/\(state.total)").accessibilityLabel("\(state.completed) of \(state.total) answered")
    }
    @ViewBuilder private func question(_ context: ActivityViewContext<ReviewActivityAttributes>, island: Bool) -> some View {
        let state = context.state
        if state.cardId.isEmpty {
            Label("Review complete", systemImage: "checkmark.circle").font(.headline)
        } else if state.needsApp {
            VStack(spacing: 8) {
                Text("Question \(state.index) needs more space").font(.subheadline)
                Link("Open question", destination: URL(string: "hormes://review")!).font(.headline)
            }
        } else if state.answered {
            VStack(alignment: .leading, spacing: 8) {
                Label(state.correct ? "Correct" : "Review this one", systemImage: state.correct ? "checkmark.circle" : "arrow.counterclockwise").font(.subheadline.weight(.semibold))
                Text(state.feedback).font(.caption).lineLimit(island ? 2 : 4)
                Button(intent: NextReviewIntent(quizId: context.attributes.quizId, cardId: state.cardId)) {
                    Text(state.index == state.total ? "Finish review" : "Next question").frame(maxWidth: .infinity, minHeight: 36)
                }.buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black)
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                if state.demo && !island { Text("DEMO REVIEW").font(.system(size: 9)).foregroundStyle(.secondary) }
                Text(state.question).font(.system(size: island ? 13 : 16, weight: .medium)).lineLimit(island ? 2 : 4)
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
                    ForEach(Array(state.options.enumerated()), id: \.offset) { index, option in
                        Button(intent: AnswerReviewIntent(quizId: context.attributes.quizId, cardId: state.cardId, choice: index)) {
                            Text(option).font(.system(size: island ? 11 : 13)).lineLimit(2)
                                .frame(maxWidth: .infinity).frame(height: island ? 38 : 44)
                                .padding(.horizontal, 4).background(.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 9))
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
    }
}
