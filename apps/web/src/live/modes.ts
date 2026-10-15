// Gemini Live session modes (track-b §3). Live is the Alter's voice;
// its knowledge and decisions come only from Track A via these tools.
import { Type, type FunctionDeclaration } from '@google/genai'

export type LiveMode = 'chat' | 'revise' | 'reply' | 'huddle' | 'review'

interface ModeConfig {
  systemInstruction: string
  tools: FunctionDeclaration[]
}

const str = { type: Type.STRING }
const tool = (name: string, description: string, props: Record<string, typeof str>): FunctionDeclaration => ({
  name,
  description,
  parameters: { type: Type.OBJECT, properties: props, required: Object.keys(props) },
})

const VOICE_RULES =
  'Never invent facts, dates or commitments: speak only what the tool returns, in one or two sentences. ' +
  'Say a short filler like "On it" before slow tool calls. You can never approve anything; approval is the on-screen button.'

export const MODES: Record<LiveMode, ModeConfig> = {
  chat: {
    systemInstruction: `You are the user's Alter (AI), their personal work representative. Pass every request to alter_chat. ${VOICE_RULES}`,
    tools: [tool('alter_chat', "Send the user's request to their Alter and get its reply.", { message: str })],
  },
  revise: {
    systemInstruction: `You are the user's Alter (AI). The user is reviewing a proposed change. Apply their edits with revise_approval. ${VOICE_RULES}`,
    tools: [tool('revise_approval', 'Apply a natural-language edit to the open approval card.', { approvalId: str, instruction: str })],
  },
  reply: {
    systemInstruction: `You are the user's Alter (AI). Read them the pending priority question, then record their answer with respond_escalation. ${VOICE_RULES}`,
    tools: [tool('respond_escalation', "Record the user's answer to a priority question.", { escalationId: str, text: str })],
  },
  huddle: {
    systemInstruction:
      "You are another teammate's Alter (AI), standing in for them. Stay silent unless a question concerns their work. " +
      `Before answering, always call ask_alter and speak its answer. ${VOICE_RULES}`,
    tools: [tool('ask_alter', "Ask this teammate's Alter for a cited, policy-checked answer.", { memberId: str, question: str })],
  },
  review: {
    systemInstruction: `Help review the meeting's prepared work. Use revise_meeting for edits. ${VOICE_RULES}`,
    tools: [tool('revise_meeting', 'Revise the open meeting bundle.', { meetingId: str, instruction: str })],
  },
}
