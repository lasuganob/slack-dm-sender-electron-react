import React from "react";
import { Paper, Stack, Group, Text, Button } from "@mantine/core";

interface UserListHelpModalProps {
  open: boolean;
  onClose: () => void;
}

const UserListHelpModal: React.FC<UserListHelpModalProps> = ({
  open,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2100,
      }}
    >
      <Paper
        shadow="xl"
        radius="md"
        p="md"
        style={{
          width: "min(600px, 90vw)",
          maxHeight: "80vh",
          overflowY: "auto",
        }}
      >
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={600} size="lg">
              User list controls
            </Text>
            <Button
              variant="subtle"
              size="xs"
              onClick={onClose}
            >
              Close
            </Button>
          </Group>

          <Text size="sm">
            <strong>Refresh users from Slack</strong> contacts Slack and downloads
            a fresh list of users. Use this when:
          </Text>

          <Text size="sm" component="ul" style={{ paddingLeft: "1.25rem" }}>
            <li>There are new hires or removed users in the workspace.</li>
            <li>
              You changed who should appear in the list (for example, updated
              Slack display names with <code>WFH</code> or <code>ISP</code>.
            </li>
          </Text>

          <Text size="sm">
            Because Slack has rate limits, this button may go on cooldown after
            use. While it’s on cooldown, you’ll see a timer in the button text
            and it will be disabled. You’ll need to wait until the countdown
            finishes before using it again.
          </Text>

          <Text size="sm" mt="sm">
            <strong>Refresh users from CSV</strong> only reloads the existing{" "}
            <code>slack_users.csv</code> file on your computer. It does{" "}
            <em>not</em> talk to Slack and is not affected by cooldown.
          </Text>

          <Text size="sm" component="ul" style={{ paddingLeft: "1.25rem" }}>
            <li>
              Use this right after you edit the <code>glats_name</code> column
              in <code>slack_users.csv</code>.
            </li>
            <li>
              Your changes to <code>glats_name</code> will appear in the app
              immediately, even if the Slack refresh is on cooldown.
            </li>
          </Text>

          <Text size="sm" c="dimmed" mt="sm">
            <strong>Tip:</strong> A common workflow is:
            <br />
            1) Refresh users from Slack once at the start of the day,
            <br />
            2) Edit <code>glats_name</code> in the CSV as needed,
            <br />
            3) Use <strong>Refresh users from CSV</strong> whenever you want
            those edits to show up in the app.
          </Text>
        </Stack>
      </Paper>
    </div>
  );
};

export default UserListHelpModal;