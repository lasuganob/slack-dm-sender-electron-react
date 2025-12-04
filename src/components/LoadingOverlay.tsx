import React from "react";
import { Paper, Stack, Loader, Text } from "@mantine/core";

interface LoadingOverlayProps {
  show: boolean;
  type?: "send" | "sync";
}

const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ show, type }) => {
  if (!show) return null;
  const action = type === "send" ? "Sending Slack DMs." : "Syncing users.";
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3000,
      }}
    >
      <Paper
        shadow="xl"
        radius="md"
        p="md"
        style={{ width: "min(320px, 90vw)", textAlign: "center" }}
      >
        <Stack align="center" gap="sm">
          <Loader />
          <Text size="sm">
            {action} Please wait until the process finishes.
          </Text>
        </Stack>
      </Paper>
    </div>
  );
};

export default LoadingOverlay;
