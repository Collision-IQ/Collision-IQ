export type Message = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type RetrievedChunk = {
  id?: string;
  content: string;
  file_id: string;
  distance?: number;
};
