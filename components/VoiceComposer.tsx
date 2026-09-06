import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';
import type { CommandStatus } from '../utils/useVoiceAgent';
import SaveButton from './SaveButton';
import { styles } from './VoiceComposer.styles';

interface VoiceComposerProps {
  title: string;
  subtitle: string;
  onCancel: () => void;
  onSave: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
  isSaving: boolean;
  heardText: string;
  commandStatus: CommandStatus | null;
  errorMessage: string | null;
  modelError: string | null;
  modelsReady: boolean;
  downloadProgress: number;
  isSessionActive: boolean;
  onMicPress: () => void;
  children: ReactNode;
}

export default function VoiceComposer({
  title,
  subtitle,
  onCancel,
  onSave,
  onDelete,
  isDeleting = false,
  isSaving,
  heardText,
  commandStatus,
  errorMessage,
  modelError,
  modelsReady,
  downloadProgress,
  isSessionActive,
  onMicPress,
  children,
}: VoiceComposerProps) {
  const statusText = !modelsReady
    ? `Loading LLM… ${Math.round(downloadProgress * 100)}%`
    : isSessionActive
      ? 'Listening…'
      : 'Tap to speak a command';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={onCancel}
            disabled={isSaving}
            style={({ pressed }) => [
              styles.cancelButton,
              pressed && styles.cancelButtonPressed,
              isSaving && styles.cancelButtonPressed,
            ]}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <SaveButton onPress={onSave} isSaving={isSaving} />
          {onDelete ? (
            <Pressable
              onPress={onDelete}
              disabled={isSaving || isDeleting}
              accessibilityRole="button"
              accessibilityLabel="Delete"
              style={({ pressed }) => [
                styles.deleteButton,
                pressed && styles.deleteButtonPressed,
                (isSaving || isDeleting) && styles.deleteButtonPressed,
              ]}
            >
              {isDeleting ? (
                <ActivityIndicator size="small" color="#D64545" />
              ) : (
                <Text style={styles.deleteText}>Delete</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      </View>

      {heardText ? (
        <Text style={styles.heardText} numberOfLines={2}>
          Heard: {heardText}
        </Text>
      ) : null}

      {commandStatus ? (
        <Text
          style={[
            styles.commandStatusText,
            commandStatus.isError && styles.commandStatusTextError,
          ]}
          numberOfLines={2}
        >
          {commandStatus.message}
        </Text>
      ) : null}

      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
      {modelError ? <Text style={styles.errorText}>{modelError}</Text> : null}

      <ScrollView contentContainerStyle={styles.scrollContent}>{children}</ScrollView>

      <View style={styles.footer}>
        <Text style={styles.statusText}>{statusText}</Text>
        <Pressable
          onPress={onMicPress}
          disabled={!modelsReady && !isSessionActive}
          style={({ pressed }) => [
            styles.micButton,
            isSessionActive && styles.micButtonActive,
            !modelsReady && !isSessionActive && styles.micButtonDisabled,
            pressed && styles.micButtonPressed,
          ]}
        >
          {!modelsReady && !isSessionActive ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.micIcon}>{isSessionActive ? '⏹' : '🎤'}</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
