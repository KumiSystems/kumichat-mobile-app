import { createSlice, createEntityAdapter, createDraftSafeSelector } from '@reduxjs/toolkit';
const lodashFilter = require('lodash.filter');
import actions from './conversationSlice.action';
import { CONVERSATION_PRIORITY_ORDER } from 'constants';
import { applyFilters, findPendingMessageIndex } from '../helpers/conversationHelpers';
export const conversationAdapter = createEntityAdapter({
  selectId: conversation => conversation.id,
});

const conversationSlice = createSlice({
  name: 'conversations',
  initialState: conversationAdapter.getInitialState({
    loading: false,
    meta: {
      mine_count: 0,
      unassigned_count: 0,
      all_count: 0,
    },
    isConversationFetching: false,
    isAllConversationsFetched: false,
    isAllMessagesFetched: false,
    conversationStatus: 'open',
    assigneeType: 'mine',
    sortFilter: 'latest',
    currentInbox: 0,
    loadingMessages: false,
    isChangingConversationStatus: false,
    isChangingConversationAssignee: false,
  }),
  reducers: {
    clearAllConversations: conversationAdapter.removeAll,
    setConversationStatus: (state, action) => {
      state.conversationStatus = action.payload;
    },
    setAssigneeType: (state, action) => {
      state.assigneeType = action.payload;
    },
    setActiveInbox: (state, action) => {
      state.currentInbox = action.payload;
    },
    setSortFilter: (state, action) => {
      state.sortFilter = action.payload;
    },
    clearConversation: (state, action) => {
      const conversationId = action.payload;
      const conversation = state.entities[conversationId];
      if (conversation) {
        conversationAdapter.removeOne(state, conversationId);
      }
    },
    addConversation: (state, action) => {
      const { currentInbox } = state;
      const conversation = action.payload;
      const { inbox_id: inboxId } = conversation;
      const isMatchingInboxFilter = !currentInbox || Number(currentInbox) === inboxId;
      if (isMatchingInboxFilter) {
        conversationAdapter.addOne(state, action.payload);
      }
    },
    updateConversation: (state, action) => {
      const conversation = action.payload;
      const conversationIds = conversationAdapter.getSelectors().selectIds(state);
      if (conversationIds.includes(conversation.id)) {
        const { messages, ...conversationAttributes } = conversation;
        conversationAdapter.updateOne(state, {
          id: conversation.id,
          changes: conversationAttributes,
        });
      } else {
        conversationAdapter.addOne(state, conversation);
      }
    },
    addMessage: (state, action) => {
      const message = action.payload;

      const { conversation_id: conversationId } = message;
      if (!conversationId) {
        return;
      }
      const conversation = state.entities[conversationId];
      // If the conversation is not present in the store, we don't need to add the message
      if (!conversation) {
        return;
      }
      const pendingMessageIndex = findPendingMessageIndex(conversation, message);
      if (pendingMessageIndex !== -1) {
        conversation.messages[pendingMessageIndex] = message;
      } else {
        conversation.messages.push(message);
        conversation.timestamp = message.created_at;
      }
    },
    updateContactsPresence: (state, action) => {
      const { contacts } = action.payload;
      const allConversations = state.entities;

      Object.keys(contacts).forEach(contactId => {
        let filteredConversations = lodashFilter(allConversations, {
          meta: { sender: { id: parseInt(contactId) } },
        });
        // TODO: This is a temporary fix for the issue of contact presence not updating if the contact goes offline
        filteredConversations.forEach(item => {
          state.entities[item.id].meta.sender.availability_status = contacts[contactId];
        });
      });
    },
  },

  extraReducers: builder => {
    builder
      .addCase(actions.fetchConversations.pending, state => {
        state.loading = true;
      })
      .addCase(actions.fetchConversations.fulfilled, (state, { payload }) => {
        conversationAdapter.upsertMany(state, payload.conversations);
        state.meta = payload.meta;
        state.loading = false;
        state.isAllConversationsFetched = payload.conversations.length < 20;
      })
      .addCase(actions.fetchConversations.rejected, (state, { error }) => {
        state.loading = false;
      })
      .addCase(actions.fetchConversationStats.fulfilled, (state, { payload }) => {
        state.meta = payload.meta;
      })
      .addCase(actions.fetchConversation.pending, state => {
        state.isConversationFetching = true;
      })
      .addCase(actions.fetchConversation.fulfilled, (state, { payload }) => {
        conversationAdapter.upsertOne(state, payload);
        state.isAllMessagesFetched = false;
        state.isConversationFetching = false;
      })
      .addCase(actions.fetchConversation.rejected, (state, { payload }) => {
        state.isConversationFetching = false;
      })
      .addCase(actions.fetchPreviousMessages.pending, state => {
        state.loadingMessages = true;
        state.isAllMessagesFetched = false;
      })
      .addCase(actions.fetchPreviousMessages.fulfilled, (state, { payload }) => {
        const { data, conversationId } = payload;
        if (!state.entities[conversationId]) {
          return;
        }
        const conversation = state.entities[conversationId];
        conversation.messages.unshift(...data);
        state.loadingMessages = false;
        state.isAllMessagesFetched = data.length < 20;
      })
      .addCase(actions.fetchPreviousMessages.rejected, state => {
        state.loadingMessages = false;
      })
      .addCase(actions.markMessagesAsRead.fulfilled, (state, { payload }) => {
        const { id, lastSeen } = payload;
        const conversation = state.entities[id];
        if (!conversation) {
          return;
        }
        conversation.unread_count = 0;
        conversation.agent_last_seen_at = lastSeen;
      })
      .addCase(actions.markMessagesAsUnread.fulfilled, (state, { payload }) => {
        const { id, unreadCount, lastSeen } = payload;
        const conversation = state.entities[id];
        if (!conversation) {
          return;
        }
        conversation.unread_count = unreadCount;
        conversation.agent_last_seen_at = lastSeen;
      })
      .addCase(actions.muteConversation.fulfilled, (state, { payload }) => {
        const { id } = payload;
        const conversation = state.entities[id];
        if (!conversation) {
          return;
        }
        conversation.muted = true;
      })
      .addCase(actions.unmuteConversation.fulfilled, (state, { payload }) => {
        const { id } = payload;
        const conversation = state.entities[id];
        if (!conversation) {
          return;
        }
        conversation.muted = false;
      })
      .addCase(actions.toggleConversationStatus.pending, (state, action) => {
        state.isChangingConversationStatus = true;
      })
      .addCase(actions.toggleConversationStatus.fulfilled, (state, { payload }) => {
        const { id, updatedStatus, updatedSnoozedUntil } = payload;
        const conversation = state.entities[id];
        if (!conversation) {
          return;
        }
        conversation.status = updatedStatus;
        conversation.snoozed_until = updatedSnoozedUntil;
        state.isChangingConversationStatus = false;
      })
      .addCase(actions.toggleConversationStatus.rejected, state => {
        state.isChangingConversationStatus = false;
      })
      .addCase(actions.updateConversationAndMessages.fulfilled, (state, { payload }) => {
        const { data, conversationId } = payload;
        const conversation = state.entities[conversationId];
        if (!conversation) {
          return;
        }
        const lastMessageId = conversation?.messages[conversation.messages.length - 1]?.id;
        const messageId = data.messages[data.messages.length - 1].id;
        // If the last message id is same as the message id, we don't need to update the conversation
        if (lastMessageId !== messageId) {
          conversationAdapter.upsertOne(state, data);
          state.isAllMessagesFetched = false;
          state.isConversationFetching = false;
        }
      })
      .addCase(actions.togglePriority.fulfilled, (state, { payload }) => {
        const { id, priority } = payload;
        const conversation = state.entities[id];
        if (!conversation) {
          return;
        }
        conversation.priority = priority;
      });
  },
});
export const conversationSelector = conversationAdapter.getSelectors(state => state.conversations);

export const selectConversationMeta = state => state.conversations.meta;
export const selectAllConversationFetched = state => state.conversations.isAllConversationsFetched;
export const selectConversationStatus = state => state.conversations.conversationStatus;
export const selectAssigneeType = state => state.conversations.assigneeType;
export const selectActiveInbox = state => state.conversations.currentInbox;
export const selectSortFilter = state => state.conversations.sortFilter;
export const selectMessagesLoading = state => state.conversations.loadingMessages;
export const selectConversationFetching = state => state.conversations.isConversationFetching;
export const selectAllMessagesFetched = state => state.conversations.isAllMessagesFetched;
export const selectConversationToggleStatus = state =>
  state.conversations.isChangingConversationStatus;
export const selectConversationAssigneeStatus = state =>
  state.conversations.isChangingConversationAssignee;
export const selectors = {
  getFilteredConversations: createDraftSafeSelector(
    [conversationSelector.selectAll, (_, filters) => filters],
    (conversations, filters) => {
      const { assigneeType, userId, sortBy } = filters;

      const comparator = {
        latest: (a, b) => b.last_activity_at - a.last_activity_at,
        sort_on_created_at: (a, b) => a.created_at - b.created_at,
        sort_on_priority: (a, b) => {
          return CONVERSATION_PRIORITY_ORDER[a.priority] - CONVERSATION_PRIORITY_ORDER[b.priority];
        },
      };
      const sortedConversations = conversations.sort(comparator[sortBy]);

      if (assigneeType === 'mine') {
        return sortedConversations.filter(conversation => {
          const { assignee } = conversation.meta;
          const shouldFilter = applyFilters(conversation, filters);
          const isAssignedToMe = assignee && assignee.id === userId;
          const isChatMine = isAssignedToMe && shouldFilter;
          return isChatMine;
        });
      }
      if (assigneeType === 'unassigned') {
        return sortedConversations.filter(conversation => {
          const isUnAssigned = !conversation.meta.assignee;
          const shouldFilter = applyFilters(conversation, filters);
          return isUnAssigned && shouldFilter;
        });
      }

      return sortedConversations.filter(conversation => {
        const shouldFilter = applyFilters(conversation, filters);
        return shouldFilter;
      });
    },
  ),
  getMessagesByConversationId: createDraftSafeSelector(
    [conversationSelector.selectEntities, (_, conversationId) => conversationId],
    (conversations, conversationId) => {
      const conversation = conversations[conversationId];
      if (!conversation) {
        return [];
      }
      return conversation.messages;
    },
  ),
  getConversationById: createDraftSafeSelector(
    [conversationSelector.selectEntities, (_, conversationId) => conversationId],
    (conversations, conversationId) => {
      return conversations[conversationId];
    },
  ),
};
export const {
  clearAllConversations,
  clearConversation,
  setConversationStatus,
  setAssigneeType,
  setActiveInbox,
  setSortFilter,
  addConversation,
  addMessage,
  updateConversation,
  updateContactsPresence,
} = conversationSlice.actions;

export default conversationSlice.reducer;
