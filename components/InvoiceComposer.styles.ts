import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F6FA',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1C1C28',
  },
  subtitle: {
    fontSize: 14,
    color: '#6E6E80',
    marginTop: 4,
  },
  headerActions: {
    marginLeft: 12,
    marginTop: 4,
    alignItems: 'flex-end',
    gap: 8,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  downloadButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#4C6FFF',
    minWidth: 64,
    alignItems: 'center',
  },
  downloadButtonPressed: {
    opacity: 0.8,
  },
  downloadButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  deleteButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#D64545',
    minWidth: 64,
    alignItems: 'center',
  },
  deleteButtonPressed: {
    opacity: 0.6,
  },
  deleteButtonText: {
    color: '#D64545',
    fontSize: 13,
    fontWeight: '600',
  },
  signOutButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  signOutButtonPressed: {
    opacity: 0.6,
  },
  signOutText: {
    color: '#6E6E80',
    fontSize: 12,
    fontWeight: '500',
  },
  heardText: {
    fontSize: 13,
    color: '#A0A0B2',
    fontStyle: 'italic',
    marginHorizontal: 24,
    marginTop: 10,
  },
  commandStatusText: {
    fontSize: 13,
    color: '#2E7D32',
    fontWeight: '600',
    marginHorizontal: 24,
    marginTop: 10,
  },
  commandStatusTextError: {
    color: '#B26A00',
  },
  errorText: {
    color: '#D64545',
    textAlign: 'center',
    marginHorizontal: 24,
    marginTop: 10,
    fontSize: 13,
  },
  promptBanner: {
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E8E8F0',
  },
  promptText: {
    fontSize: 14,
    color: '#1C1C28',
    fontWeight: '600',
  },
  promptActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  promptYes: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#4C6FFF',
  },
  promptNo: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D0D0DC',
  },
  promptButtonPressed: {
    opacity: 0.7,
  },
  promptYesText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  promptNoText: {
    color: '#1C1C28',
    fontSize: 13,
    fontWeight: '600',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  statusText: {
    fontSize: 14,
    color: '#6E6E80',
    marginBottom: 14,
  },
  micButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#4C6FFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#4C6FFF',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  micButtonActive: {
    backgroundColor: '#D64545',
  },
  micButtonDisabled: {
    backgroundColor: '#A0A0B2',
    shadowOpacity: 0.15,
  },
  micButtonPressed: {
    opacity: 0.8,
  },
  micIcon: {
    fontSize: 32,
    color: '#FFFFFF',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
