/** The phone receives only an explicitly exported quiz, never daemon commands or credentials. */
export interface PhoneQuizCard {
  id: string; front: string; options: string[]; correctOption: number; explanation: string;
}
export interface PhoneQuiz {
  version: 1; id: string; sessionId: string; deckId: string; title: string; demo: boolean;
  issuedAt: number; goalVersion: number; cards: PhoneQuizCard[];
  answers: { cardId: string; choiceIndex: number; result: "correct" | "incorrect"; assisted: boolean }[];
  limitation: string;
}
export interface PhoneAnswer {
  attemptId: string; quizId: string; cardId: string; choiceIndex: number; answeredAt: number;
}
export interface PhoneAnswerReceipt {
  attemptId: string; recordId: string; cardId: string; result: "correct" | "incorrect"; assisted: boolean;
}
export interface PhoneDevice { id: string; name: string; pairedAt: number; lastSeenAt: number; automaticDelivery?: boolean }
export interface PhoneState {
  enabled: boolean; devices: PhoneDevice[]; error?: string;
  pushConfigured?: boolean;
  pairing?: { url: string; expiresAt: number };
}
