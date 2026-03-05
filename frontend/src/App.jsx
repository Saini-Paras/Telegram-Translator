import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import { io } from 'socket.io-client';
import { Search, Info, Settings, MoreVertical, LayoutTemplate, Plus, X, MessageSquare, Users } from 'lucide-react';
import './index.css';

const SOCKET_SERVER_URL = import.meta.env.PROD ? "" : "http://localhost:5002";

function App() {
  const [messages, setMessages] = useState([]);
  const [socket, setSocket] = useState(null);
  const messagesEndRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [showOriginal, setShowOriginal] = useState(false);

  // Chat Selection State
  const [selectedChats, setSelectedChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [availableDialogs, setAvailableDialogs] = useState([]);
  const [loadingDialogs, setLoadingDialogs] = useState(false);
  const [addingIds, setAddingIds] = useState([]);

  // Load selected chats
  const loadSelectedChats = async () => {
    try {
      const response = await axios.get(`${SOCKET_SERVER_URL}/api/selected-chats`);
      setSelectedChats(response.data);
      if (response.data.length > 0 && !activeChat) {
        setActiveChat(response.data[0]);
      }
    } catch (error) {
      console.error("Failed to load selected chats", error);
    }
  };

  useEffect(() => {
    loadSelectedChats();

    const newSocket = io(SOCKET_SERVER_URL, {
      reconnectionDelayMax: 10000,
    });
    setSocket(newSocket);

    newSocket.on("new_message", (message) => {
      // If no active chat, or the message is for the active chat
      setActiveChat(currentActive => {
        if (!currentActive || message.telegram_chat_id === currentActive.telegram_chat_id || message.telegram_chat_id === `-100${currentActive.telegram_chat_id}` || `-100${message.telegram_chat_id}` === currentActive.telegram_chat_id) {
          setMessages((prevMessages) => {
            // Prevent duplicates
            if (prevMessages.some(m => m.telegram_message_id === message.telegram_message_id)) return prevMessages;
            return [...prevMessages, message];
          });
          setTimeout(scrollToBottom, 50);
        }
        return currentActive;
      });
    });

    return () => newSocket.close();
  }, []);

  // Fetch messages whenever activeChat changes
  useEffect(() => {
    const fetchMessages = async () => {
      if (!activeChat) {
        setMessages([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const url = `${SOCKET_SERVER_URL}/api/messages?page=1&limit=50&chat_id=${activeChat.telegram_chat_id}`;
        const response = await axios.get(url);
        setMessages(response.data);
      } catch (error) {
        console.error("Failed to fetch messages", error);
      } finally {
        setLoading(false);
        setTimeout(scrollToBottom, 100);
      }
    };

    fetchMessages();
  }, [activeChat]);

  // Load available dialogs when modal opens
  useEffect(() => {
    if (showAddModal && availableDialogs.length === 0) {
      setLoadingDialogs(true);
      axios.get(`${SOCKET_SERVER_URL}/api/dialogs`)
        .then(res => setAvailableDialogs(res.data))
        .catch(err => console.error("Failed to load dialogs", err))
        .finally(() => setLoadingDialogs(false));
    }
  }, [showAddModal]);

  const handleAddChat = async (dialog) => {
    try {
      setAddingIds(prev => [...prev, dialog.id]);
      const res = await axios.post(`${SOCKET_SERVER_URL}/api/selected-chats`, {
        telegram_chat_id: dialog.id,
        title: dialog.title,
        type: dialog.isChannel ? 'channel' : dialog.isGroup ? 'group' : 'user'
      });
      setSelectedChats(prev => [res.data, ...prev]);
      if (!activeChat) setActiveChat(res.data);
    } catch (error) {
      console.error("Failed to add chat", error);
    } finally {
      setAddingIds(prev => prev.filter(id => id !== dialog.id));
    }
  };

  const handleRemoveChat = async (chatId, e) => {
    e.stopPropagation();
    try {
      await axios.delete(`${SOCKET_SERVER_URL}/api/selected-chats/${chatId}`);
      setSelectedChats(prev => prev.filter(c => c.telegram_chat_id !== chatId));
      if (activeChat && activeChat.telegram_chat_id === chatId) {
        setActiveChat(null);
      }
    } catch (error) {
      console.error("Failed to remove chat", error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const getInitials = (name) => {
    if (!name) return '?';
    if (name.startsWith('@')) name = name.substring(1);
    const parts = name.split(' ').filter(Boolean);
    if (parts.length > 1) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  // Generate a consistent color based on string
  const stringToColor = (str) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = ['#e17076', '#7bc862', '#6ec9cb', '#65aadd', '#a695e7', '#ee7aae', '#fa9b50', '#a19391'];
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="telegram-app">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="search-bar" style={{ marginRight: '10px' }}>
            <Search size={18} className="search-icon" />
            <input type="text" placeholder="Search" />
          </div>
          <button
            className="add-chat-btn"
            onClick={() => setShowAddModal(true)}
            title="Add Telegram Chat"
          >
            <Plus size={24} />
          </button>
        </div>
        <div className="chat-list">
          {selectedChats.map((chat) => (
            <div
              key={chat.telegram_chat_id}
              className={`chat-list-item ${activeChat && activeChat.telegram_chat_id === chat.telegram_chat_id ? 'active' : ''}`}
              onClick={() => setActiveChat(chat)}
            >
              <div className="chat-avatar" style={{ backgroundColor: stringToColor(chat.title) }}>
                <span>{getInitials(chat.title)}</span>
              </div>
              <div className="chat-info">
                <div className="chat-name">{chat.title}</div>
                <div className="chat-preview">Active Sync</div>
              </div>
              <button
                className="modal-close"
                onClick={(e) => handleRemoveChat(chat.telegram_chat_id, e)}
                title="Remove Sync"
              >
                <X size={16} />
              </button>
            </div>
          ))}
          {selectedChats.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              No chats selected. Click + to add one.
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="chat-area">
        <div className="chat-header">
          <div className="header-info">
            <h2 className="header-title">{activeChat ? activeChat.title : 'Translated Live Feed'}</h2>
            <span className="header-subtitle">
              {activeChat ? `${messages.length} messages loaded • Live Translation Active` : 'Select a chat to view messages'}
            </span>
          </div>
          <div className="header-actions">
            <button
              className={`icon-button ${showOriginal ? 'active-icon' : ''}`}
              onClick={() => setShowOriginal(!showOriginal)}
              title={showOriginal ? 'Hide Original Texts' : 'Show Original Texts'}
            >
              <LayoutTemplate size={20} />
            </button>
            <button className="icon-button" title="Search"><Search size={20} /></button>
            <button className="icon-button" title="More details"><MoreVertical size={20} /></button>
          </div>
        </div>

        <div className="messages-container">
          {!activeChat ? (
            <div className="welcome-screen">
              <div style={{ backgroundColor: 'var(--accent-color)', width: 80, height: 80, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                <MessageSquare size={40} color="white" />
              </div>
              <h2>Welcome to Telegram Translator</h2>
              <p>Connect your Telegram chats and automatically translate incoming messages in real-time using DeepL's powerful AI.</p>
              <button className="welcome-btn" onClick={() => setShowAddModal(true)}>
                <Plus size={20} /> Select Chats to Sync
              </button>
            </div>
          ) : loading ? (
            <div className="loading-spinner-container">
              <div className="loading-spinner"></div>
              <span>Loading messages for {activeChat.title}...</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">💬</div>
              <h3>No Messages Yet</h3>
              <p>Waiting for messages in {activeChat.title}...</p>
            </div>
          ) : (
            messages.map((msg, index) => {
              // Group messages by the same user if they are consecutive
              const prevMsg = index > 0 ? messages[index - 1] : null;
              const isFirstInGroup = !prevMsg || prevMsg.username !== msg.username || new Date(msg.timestamp) - new Date(prevMsg.timestamp) > 5 * 60 * 1000;

              const avatarColor = stringToColor(msg.username || 'System');

              // Only display if we have a translation, otherwise original
              const displayText = msg.translated_text || msg.original_text || "...";
              const hasTranslation = msg.translated_text && msg.original_text !== msg.translated_text;

              return (
                <div key={msg._id || msg.telegram_message_id || index} className={`message-wrapper ${isFirstInGroup ? 'first-in-group' : 'grouped'}`}>
                  {isFirstInGroup && (
                    <div className="message-avatar" style={{ backgroundColor: avatarColor }} title={msg.username}>
                      {getInitials(msg.username)}
                    </div>
                  )}
                  <div className={`message-bubble ${!isFirstInGroup ? 'no-avatar' : ''}`}>
                    {isFirstInGroup && (
                      <div className="message-sender" style={{ color: avatarColor }}>
                        {msg.username || 'Unknown User'}
                      </div>
                    )}

                    <div className="message-content">
                      <div className="translated-text" dir="auto">
                        {displayText}
                      </div>

                      {showOriginal && hasTranslation && (
                        <div className="original-text">
                          <div className="original-label">Original ({msg.detected_language}):</div>
                          <div dir="auto">{msg.original_text}</div>
                        </div>
                      )}
                    </div>

                    <div className="message-meta">
                      <span className="message-time">
                        {format(new Date(msg.timestamp || Date.now()), 'HH:mm')}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} className="scroll-anchor" />
        </div>

        {/* Fake Input Area to complete the Telegram look */}
        <div className="chat-input-area">
          <div className="chat-input-wrapper">
            <input type="text" placeholder="Translations will appear automatically. Read-only view." disabled />
          </div>
        </div>
      </div>

      {/* Add Chat Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Telegram Chat to Sync</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>
                <X size={24} />
              </button>
            </div>

            <div className="modal-body">
              {loadingDialogs ? (
                <div style={{ padding: 40, textAlign: 'center' }}>
                  <div className="loading-spinner" style={{ margin: '0 auto 16px' }}></div>
                  <div style={{ color: 'var(--text-secondary)' }}>Loading your Telegram chats...</div>
                </div>
              ) : availableDialogs.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
                  No chats found or still syncing with Telegram...
                </div>
              ) : (
                availableDialogs.map(dialog => {
                  const isAlreadySelected = selectedChats.some(c => c.telegram_chat_id === dialog.id);
                  const isAdding = addingIds.includes(dialog.id);

                  return (
                    <div key={dialog.id} className="dialog-item">
                      <div className="dialog-avatar" style={{ backgroundColor: stringToColor(dialog.title) }}>
                        {dialog.isGroup || dialog.isChannel ? <Users size={20} /> : getInitials(dialog.title)}
                      </div>
                      <div className="dialog-info">
                        <div className="dialog-title">{dialog.title}</div>
                        <div className="dialog-type">
                          {dialog.isChannel ? 'Channel' : dialog.isGroup ? 'Group' : 'Private Chat'}
                        </div>
                      </div>
                      <div className="dialog-action">
                        {isAlreadySelected ? (
                          <button
                            className="btn-remove"
                            onClick={() => handleRemoveChat(dialog.id, { stopPropagation: () => { } })}
                          >
                            Remove
                          </button>
                        ) : (
                          <button
                            className="btn-add"
                            onClick={() => handleAddChat(dialog)}
                            disabled={isAdding}
                          >
                            {isAdding ? 'Adding...' : 'Add'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
