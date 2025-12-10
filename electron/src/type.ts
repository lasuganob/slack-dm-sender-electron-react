export type SlackUser = {
  id: string;
  username: string;
  slackName: string;
  email?: string;
  glatsName?: string;
};

export type AppConfig = {
  slackBotToken: string;
  sendOnlyToWfhIspUsers?: boolean;
  exceptionUserIds?: string[];
};
