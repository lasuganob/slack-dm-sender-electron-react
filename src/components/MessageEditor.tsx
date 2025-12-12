import {
  ActionIcon,
  Group,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { IconBold, IconCode, IconItalic, IconStrikethrough } from "@tabler/icons-react";
import React, { type RefObject } from "react";

interface MessageEditorProps {
  message: string;
  setMessage: (msg: string) => void;
  busy: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  wrapSelection: (wrapper: "*" | "_" | "~" | "`") => void;
}

const MessageEditor: React.FC<MessageEditorProps> = ({
  message,
  setMessage,
  busy,
  textareaRef,
  wrapSelection,
}) => (
  <>
    <Group gap="xs">
      <Tooltip label="Bold (*text*)">
        <ActionIcon
          variant="light"
          size="xs"
          onClick={() => wrapSelection("*")}
          disabled={busy}
        >
          <IconBold size={14} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Italic (_text_)">
        <ActionIcon
          variant="light"
          size="xs"
          onClick={() => wrapSelection("_")}
          disabled={busy}
        >
          <IconItalic size={14} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Strikethrough (~text~)">
        <ActionIcon
          variant="light"
          size="xs"
          onClick={() => wrapSelection("~")}
          disabled={busy}
        >
          <IconStrikethrough size={14} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Inline code (`code`)">
        <ActionIcon
          variant="light"
          size="xs"
          onClick={() => wrapSelection("`")}
          disabled={busy}
        >
          <IconCode size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
    <Textarea
      ref={textareaRef}
      placeholder="Type your message here..."
      minRows={6}
      autosize
      value={message}
      onChange={(e) => setMessage(e.currentTarget.value)}
      disabled={busy}
    />
  </>
);

export default MessageEditor;
