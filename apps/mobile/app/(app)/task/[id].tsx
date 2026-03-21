import { useEffect, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
} from 'react-native'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { useTaskStore } from '../../../src/store/tasks'
import { api } from '../../../src/api/client'
import type { CleaningTaskDto, CleaningNoteDto } from '@housekeeping/shared'
import { CleaningStatus } from '@housekeeping/shared'

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { tasks, startTask, endTask } = useTaskStore()

  const task = tasks.find((t) => t.id === id)
  const [notes, setNotes] = useState<CleaningNoteDto[]>([])
  const [noteInput, setNoteInput] = useState('')
  const [showNoteModal, setShowNoteModal] = useState(false)
  const [showIssueModal, setShowIssueModal] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    if (id) {
      api.get<CleaningNoteDto[]>(`/tasks/${id}/notes`).then(setNotes).catch(() => {})
    }
  }, [id])

  if (!task) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#4F46E5" />
      </View>
    )
  }

  const room = task.bed?.room
  const isReady = task.status === CleaningStatus.READY || task.status === CleaningStatus.PENDING
  const isInProgress = task.status === CleaningStatus.IN_PROGRESS || task.status === CleaningStatus.PAUSED
  const isDone = task.status === CleaningStatus.DONE || task.status === CleaningStatus.VERIFIED

  async function handleStart() {
    setActionLoading(true)
    try {
      await startTask(id!)
    } catch (err) {
      Alert.alert('Error', 'No se pudo iniciar la tarea')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleEnd() {
    if (notes.length > 0) {
      Alert.alert(
        'Finalizar limpieza',
        `Has agregado ${notes.length} nota(s) para recepción. ¿Confirmar como limpia?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Confirmar', onPress: doEnd },
        ],
      )
    } else {
      Alert.alert('Finalizar limpieza', '¿Confirmar habitación como limpia?', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', onPress: doEnd },
      ])
    }
  }

  async function doEnd() {
    setActionLoading(true)
    try {
      await endTask(id!)
      router.back()
    } catch (err) {
      Alert.alert('Error', 'No se pudo finalizar la tarea')
    } finally {
      setActionLoading(false)
    }
  }

  async function submitNote() {
    if (!noteInput.trim()) return
    try {
      const note = await api.post<CleaningNoteDto>(`/tasks/${id}/notes`, {
        content: noteInput.trim(),
      })
      setNotes((prev) => [...prev, note])
      setNoteInput('')
      setShowNoteModal(false)
    } catch {
      Alert.alert('Error', 'No se pudo guardar la nota')
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: `Room ${room?.number ?? '—'}`,
          headerBackTitle: 'Mis rooms',
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Room info */}
        <View style={styles.roomCard}>
          <Text style={styles.roomNumber}>{room?.number ?? '—'}</Text>
          <Text style={styles.roomSub}>
            {room?.type === 'PRIVATE' ? 'Habitación privada' : 'Dormitorio compartido'}
            {room?.floor != null ? ` · Piso ${room.floor}` : ''}
          </Text>
          {task.bed && (
            <Text style={styles.bedLabel}>Cama: {task.bed.label}</Text>
          )}
        </View>

        {/* Reception notes */}
        {task.bed && (
          <CheckoutNotes taskId={id!} />
        )}

        {/* Housekeeper notes */}
        {notes.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notas para recepción</Text>
            {notes.map((n) => (
              <View key={n.id} style={styles.noteItem}>
                <Text style={styles.noteText}>{n.content}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.actions}>
          {isReady && (
            <TouchableOpacity
              style={[styles.btnPrimary, styles.btnGreen, actionLoading && styles.btnDisabled]}
              onPress={handleStart}
              disabled={actionLoading}
              activeOpacity={0.8}
            >
              {actionLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Iniciar limpieza</Text>
              )}
            </TouchableOpacity>
          )}

          {isInProgress && (
            <>
              <TouchableOpacity
                style={styles.btnOutline}
                onPress={() => setShowNoteModal(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.btnOutlineText}>+ Agregar nota</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btnOutline}
                onPress={() => setShowIssueModal(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.btnOutlineText}>⚠️ Reportar incidencia</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnPrimary, styles.btnRed, actionLoading && styles.btnDisabled]}
                onPress={handleEnd}
                disabled={actionLoading}
                activeOpacity={0.8}
              >
                {actionLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnText}>Finalizar limpieza</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          {isDone && (
            <View style={styles.doneBanner}>
              <Text style={styles.doneBannerText}>✓ Habitación marcada como limpia</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Note modal */}
      <Modal visible={showNoteModal} animationType="slide" transparent onRequestClose={() => setShowNoteModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Nota para recepción</Text>
            <TextInput
              style={styles.noteTextInput}
              placeholder="Ej: Falta jabón en el baño, toalla rota..."
              value={noteInput}
              onChangeText={setNoteInput}
              multiline
              numberOfLines={3}
              autoFocus
              placeholderTextColor="#9CA3AF"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={() => setShowNoteModal(false)} style={styles.modalBtnCancel}>
                <Text style={styles.modalBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitNote} style={styles.modalBtnConfirm}>
                <Text style={styles.modalBtnConfirmText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Issue modal */}
      <Modal visible={showIssueModal} animationType="slide" onRequestClose={() => setShowIssueModal(false)}>
        <IssueReportScreen
          taskId={id!}
          onClose={() => setShowIssueModal(false)}
        />
      </Modal>
    </>
  )
}

function CheckoutNotes({ taskId }: { taskId: string }) {
  const [checkoutNote, setCheckoutNote] = useState<string | null>(null)

  useEffect(() => {
    api.get<CleaningTaskDto>(`/tasks/${taskId}`)
      .then((t) => {
        // notes from checkout come via task's checkout relation
        if ((t as unknown as { checkoutNotes?: string }).checkoutNotes) {
          setCheckoutNote((t as unknown as { checkoutNotes?: string }).checkoutNotes ?? null)
        }
      })
      .catch(() => {})
  }, [taskId])

  if (!checkoutNote) return null

  return (
    <View style={styles.checkoutNote}>
      <Text style={styles.checkoutNoteLabel}>Nota de recepción</Text>
      <Text style={styles.checkoutNoteText}>{checkoutNote}</Text>
    </View>
  )
}

function IssueReportScreen({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const categories = ['PLUMBING', 'ELECTRICAL', 'FURNITURE', 'PEST', 'OTHER'] as const
  const categoryLabels: Record<string, string> = {
    PLUMBING: 'Plomería',
    ELECTRICAL: 'Eléctrico',
    FURNITURE: 'Mobiliario',
    PEST: 'Plagas',
    OTHER: 'Otro',
  }
  const [category, setCategory] = useState('OTHER')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    if (!description.trim()) return
    setLoading(true)
    try {
      await api.post(`/tasks/${taskId}/issues`, { category, description: description.trim() })
      Alert.alert('Incidencia reportada', 'El supervisor ha sido notificado')
      onClose()
    } catch {
      Alert.alert('Error', 'No se pudo reportar la incidencia')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollView style={styles.issueContainer} contentContainerStyle={{ padding: 20 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Text style={styles.modalTitle}>Reportar incidencia</Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={{ color: '#6B7280', fontSize: 16 }}>Cancelar</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.sectionTitle}>Categoría</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {categories.map((c) => (
          <TouchableOpacity
            key={c}
            onPress={() => setCategory(c)}
            style={[styles.catChip, category === c && styles.catChipSelected]}
          >
            <Text style={[styles.catChipText, category === c && styles.catChipTextSelected]}>
              {categoryLabels[c]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.sectionTitle}>Descripción</Text>
      <TextInput
        style={[styles.noteTextInput, { height: 100 }]}
        placeholder="Describe el problema..."
        value={description}
        onChangeText={setDescription}
        multiline
        placeholderTextColor="#9CA3AF"
      />
      <TouchableOpacity
        style={[styles.btnPrimary, { marginTop: 20 }, loading && styles.btnDisabled]}
        onPress={handleSubmit}
        disabled={loading}
        activeOpacity={0.8}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Enviar reporte</Text>}
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  roomCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  roomNumber: { fontSize: 36, fontWeight: '800', color: '#111827' },
  roomSub: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  bedLabel: { fontSize: 13, color: '#9CA3AF', marginTop: 4 },
  checkoutNote: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  checkoutNoteLabel: { fontSize: 11, fontWeight: '600', color: '#B45309', textTransform: 'uppercase', marginBottom: 4 },
  checkoutNoteText: { fontSize: 14, color: '#78350F' },
  section: { gap: 8 },
  sectionTitle: { fontSize: 11, fontWeight: '600', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5 },
  noteItem: { backgroundColor: '#F0FDF4', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#BBF7D0' },
  noteText: { fontSize: 14, color: '#166534' },
  actions: { gap: 10, marginTop: 8 },
  btnPrimary: { borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  btnGreen: { backgroundColor: '#10B981' },
  btnRed: { backgroundColor: '#EF4444' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnOutline: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    backgroundColor: '#fff',
  },
  btnOutlineText: { color: '#374151', fontSize: 15, fontWeight: '500' },
  doneBanner: { backgroundColor: '#D1FAE5', borderRadius: 12, padding: 16, alignItems: 'center' },
  doneBannerText: { color: '#065F46', fontSize: 15, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 16 },
  noteTextInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    textAlignVertical: 'top',
    minHeight: 80,
    marginBottom: 16,
  },
  modalButtons: { flexDirection: 'row', gap: 12 },
  modalBtnCancel: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10, backgroundColor: '#F3F4F6' },
  modalBtnCancelText: { color: '#6B7280', fontWeight: '600' },
  modalBtnConfirm: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10, backgroundColor: '#4F46E5' },
  modalBtnConfirmText: { color: '#fff', fontWeight: '600' },
  issueContainer: { flex: 1, backgroundColor: '#F9FAFB' },
  catChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#fff' },
  catChipSelected: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  catChipText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  catChipTextSelected: { color: '#fff' },
})
