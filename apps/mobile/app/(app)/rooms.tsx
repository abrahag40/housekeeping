import { useEffect, useCallback } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  AppState,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useTaskStore } from '../../src/store/tasks'
import { useAuthStore } from '../../src/store/auth'
import { CleaningStatus, Priority } from '@housekeeping/shared'
import type { CleaningTaskDto } from '@housekeeping/shared'
import { Stack } from 'expo-router'

const PRIORITY_ORDER = [Priority.URGENT, Priority.HIGH, Priority.MEDIUM, Priority.LOW]

function sortTasks(tasks: CleaningTaskDto[]): CleaningTaskDto[] {
  const statusOrder = [
    CleaningStatus.IN_PROGRESS,
    CleaningStatus.PAUSED,
    CleaningStatus.READY,
    CleaningStatus.PENDING,
    CleaningStatus.DONE,
  ]
  return [...tasks].sort((a, b) => {
    const sa = statusOrder.indexOf(a.status)
    const sb = statusOrder.indexOf(b.status)
    if (sa !== sb) return sa - sb
    return PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)
  })
}

export default function RoomsScreen() {
  const { tasks, loading, fetchTasks } = useTaskStore()
  const { user, logout } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    fetchTasks()
  }, [])

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') fetchTasks()
    })
    return () => sub.remove()
  }, [])

  const handleLogout = useCallback(() => {
    logout()
  }, [logout])

  const activeTasks = tasks.filter(
    (t) => t.status !== CleaningStatus.VERIFIED && t.status !== CleaningStatus.CANCELLED,
  )
  const doneTasks = tasks.filter((t) => t.status === CleaningStatus.DONE || t.status === CleaningStatus.VERIFIED)
  const sorted = sortTasks(activeTasks)

  function renderTask({ item }: { item: CleaningTaskDto }) {
    return <TaskCard task={item} onPress={() => router.push(`/(app)/task/${item.id}`)} />
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Mis habitaciones',
          headerRight: () => (
            <TouchableOpacity onPress={handleLogout} style={{ marginRight: 4 }}>
              <Text style={{ color: '#6B7280', fontSize: 14 }}>Salir</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <FlatList
        data={sorted}
        keyExtractor={(t) => t.id}
        renderItem={renderTask}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchTasks} tintColor="#4F46E5" />
        }
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          user ? (
            <Text style={styles.greeting}>Hola, {user.name.split(' ')[0]}</Text>
          ) : null
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No tienes habitaciones asignadas</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          doneTasks.length > 0 ? (
            <View style={styles.doneSection}>
              <Text style={styles.doneSectionTitle}>Completadas hoy</Text>
              {doneTasks.map((t) => (
                <TaskCard key={t.id} task={t} onPress={() => router.push(`/(app)/task/${t.id}`)} />
              ))}
            </View>
          ) : null
        }
      />
    </>
  )
}

function TaskCard({ task, onPress }: { task: CleaningTaskDto; onPress: () => void }) {
  const room = task.bed?.room
  const isInProgress = task.status === CleaningStatus.IN_PROGRESS || task.status === CleaningStatus.PAUSED
  const isReady = task.status === CleaningStatus.READY
  const isDone = task.status === CleaningStatus.DONE || task.status === CleaningStatus.VERIFIED
  const isUrgent = task.priority === Priority.URGENT

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isInProgress && styles.cardInProgress,
        isReady && styles.cardReady,
        isDone && styles.cardDone,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View>
          <View style={styles.roomRow}>
            {isUrgent && <Text style={styles.urgentBadge}>🔴 </Text>}
            <Text style={styles.roomNumber}>{room?.number ?? '—'}</Text>
            {task.bed && <Text style={styles.bedLabel}> · {task.bed.label}</Text>}
          </View>
          <Text style={styles.roomSub}>
            {room?.type === 'PRIVATE' ? 'Privada' : 'Compartida'}
            {room?.floor != null ? ` · Piso ${room.floor}` : ''}
          </Text>
        </View>
        <StatusBadge status={task.status} />
      </View>
    </TouchableOpacity>
  )
}

function StatusBadge({ status }: { status: CleaningStatus }) {
  const map: Record<CleaningStatus, { label: string; bg: string; color: string }> = {
    [CleaningStatus.PENDING]: { label: 'Pendiente', bg: '#F3F4F6', color: '#6B7280' },
    [CleaningStatus.READY]: { label: 'Lista', bg: '#FEF3C7', color: '#B45309' },
    [CleaningStatus.UNASSIGNED]: { label: 'Sin asignar', bg: '#FEE2E2', color: '#B91C1C' },
    [CleaningStatus.IN_PROGRESS]: { label: 'Limpiando', bg: '#DBEAFE', color: '#1D4ED8' },
    [CleaningStatus.PAUSED]: { label: 'Pausada', bg: '#FEF9C3', color: '#A16207' },
    [CleaningStatus.DONE]: { label: 'Lista ✓', bg: '#D1FAE5', color: '#065F46' },
    [CleaningStatus.VERIFIED]: { label: 'Verificada', bg: '#EDE9FE', color: '#5B21B6' },
    [CleaningStatus.CANCELLED]: { label: 'Cancelada', bg: '#F3F4F6', color: '#9CA3AF' },
  }
  const s = map[status]
  return (
    <View style={[styles.badge, { backgroundColor: s.bg }]}>
      <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  greeting: { fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardInProgress: { borderColor: '#93C5FD', backgroundColor: '#EFF6FF' },
  cardReady: { borderColor: '#FCD34D', backgroundColor: '#FFFBEB' },
  cardDone: { opacity: 0.7 },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  roomRow: { flexDirection: 'row', alignItems: 'center' },
  urgentBadge: { fontSize: 13 },
  roomNumber: { fontSize: 18, fontWeight: '700', color: '#111827' },
  bedLabel: { fontSize: 14, color: '#6B7280' },
  roomSub: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 14, color: '#9CA3AF' },
  doneSection: { marginTop: 24, gap: 8 },
  doneSectionTitle: { fontSize: 12, fontWeight: '600', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
})
