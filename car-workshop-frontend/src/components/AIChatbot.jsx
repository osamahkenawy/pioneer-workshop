import { useState, useRef, useEffect, useContext } from 'react';
import { 
  ChatBubble, Send, Xmark, Refresh, LightBulb,
  User, Flash, Wallet, Building, Calendar, Search, Sparks, ArrowRight
} from 'iconoir-react';
import { Link } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import api from '../lib/api';
import './AIChatbot.css';

export default function AIChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: 'bot',
      text: "Hi! I'm your AI CRM assistant powered by ChatGPT. Ask me about your leads, deals, activities, or anything else!",
      actions: [],
      timestamp: new Date()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [conversationHistory, setConversationHistory] = useState([]);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const { user } = useContext(AuthContext);

  const openFullPage = () => {
    setIsOpen(false);
    window.location.href = '/mwasalat-ai';
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSend = async () => {
    if (!inputValue.trim()) return;

    const userMessage = {
      id: Date.now(),
      type: 'user',
      text: inputValue,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    const currentInput = inputValue;
    setInputValue('');
    setIsTyping(true);

    try {
      // Call backend AI API
      const response = await api.post('/ai/chat', {
        message: currentInput,
        conversationHistory: conversationHistory
      });

      if (response.success) {
        const aiData = response.data;
        
        // Update conversation history for context
        setConversationHistory(prev => [
          ...prev,
          { role: 'user', content: currentInput },
          { role: 'assistant', content: aiData.response }
        ].slice(-10)); // Keep last 10 messages

        const botMessage = {
          id: Date.now() + 1,
          type: 'bot',
          text: aiData.response,
          actions: aiData.actions || [],
          isGPT: !aiData.fallback, // Flag to show GPT badge
          timestamp: new Date()
        };

        setMessages(prev => [...prev, botMessage]);
      } else {
        throw new Error(response.message);
      }
    } catch (error) {
      console.error('AI Chat error:', error);
      const errorMessage = {
        id: Date.now() + 1,
        type: 'bot',
        text: "I'm sorry, I encountered an error. Please try again.",
        actions: [],
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReset = () => {
    setMessages([
      {
        id: Date.now(),
        type: 'bot',
        text: "Chat reset! How can I help you today?",
        actions: [],
        timestamp: new Date()
      }
    ]);
    setConversationHistory([]);
  };

  const handleQuickAction = (query) => {
    setInputValue(query);
    // Use setTimeout to ensure state is updated before sending
    setTimeout(() => {
      const input = document.querySelector('.chatbot-input input');
      if (input) {
        input.value = query;
        handleSendWithQuery(query);
      }
    }, 50);
  };

  const handleSendWithQuery = async (query) => {
    if (!query.trim()) return;

    const userMessage = {
      id: Date.now(),
      type: 'user',
      text: query,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);

    try {
      const response = await api.post('/ai/chat', {
        message: query,
        conversationHistory: conversationHistory
      });

      if (response.success) {
        const aiData = response.data;
        
        setConversationHistory(prev => [
          ...prev,
          { role: 'user', content: query },
          { role: 'assistant', content: aiData.response }
        ].slice(-10));

        const botMessage = {
          id: Date.now() + 1,
          type: 'bot',
          text: aiData.response,
          actions: aiData.actions || [],
          isGPT: !aiData.fallback,
          timestamp: new Date()
        };

        setMessages(prev => [...prev, botMessage]);
      }
    } catch (error) {
      console.error('AI Chat error:', error);
    } finally {
      setIsTyping(false);
    }
  };

  const quickActions = [
    { label: 'My Leads', query: 'How many leads do I have?' },
    { label: 'Open Deals', query: 'Show me my open deals and pipeline value' },
    { label: 'Overdue Tasks', query: 'What activities are overdue?' },
    { label: 'Won Revenue', query: 'What is my total won revenue?' }
  ];

  const formatMessage = (text) => {
    if (!text) return null;
    
    // Convert **text** to bold and handle line breaks
    return text.split('\n').map((line, i) => (
      <span key={i}>
        {line.split(/(\*\*.*?\*\*)/).map((part, j) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={j}>{part.slice(2, -2)}</strong>;
          }
          // Handle bullet points
          if (part.startsWith('• ')) {
            return <span key={j} className="bullet-point">{part}</span>;
          }
          return part;
        })}
        {i < text.split('\n').length - 1 && <br />}
      </span>
    ));
  };

  return (
    <>
      {/* Chat Button */}
      <button 
        className={`chatbot-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Open AI Assistant"
      >
        {isOpen ? (
          <Xmark width={24} height={24} />
        ) : (
          <>
            <Sparks width={24} height={24} />
            <span className="trigger-label">AI Assistant</span>
          </>
        )}
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className="chatbot-window">
          {/* Header */}
          <div className="chatbot-header">
            <div className="chatbot-avatar">
              <Sparks width={20} height={20} />
            </div>
            <div className="chatbot-info">
              <h4>AI CRM Assistant</h4>
              <span className="status-online">
                <span className="gpt-badge">Powered by ChatGPT</span>
              </span>
            </div>
            <button className="expand-btn" onClick={openFullPage} title="Open Full Page">
              <ArrowRight width={18} height={18} />
            </button>
            <button className="reset-btn" onClick={handleReset} title="Reset Chat">
              <Refresh width={18} height={18} />
            </button>
          </div>

          {/* Messages */}
          <div className="chatbot-messages">
            {messages.map((message) => (
              <div key={message.id} className={`message ${message.type}`}>
                {message.type === 'bot' && (
                  <div className="message-avatar">
                    <Sparks width={14} height={14} />
                  </div>
                )}
                <div className="message-content">
                  <div className="message-text">
                    {formatMessage(message.text)}
                  </div>
                  {message.actions && message.actions.length > 0 && (
                    <div className="message-actions">
                      {message.actions.map((action, idx) => (
                        <Link 
                          key={idx} 
                          to={action.path || action.link || '#'} 
                          className="action-btn"
                          onClick={() => setIsOpen(false)}
                        >
                          {action.label}
                        </Link>
                      ))}
                    </div>
                  )}
                  {message.isGPT && (
                    <div className="gpt-indicator">
                      <Sparks width={10} height={10} /> GPT
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            {isTyping && (
              <div className="message bot">
                <div className="message-avatar">
                  <Sparks width={14} height={14} />
                </div>
                <div className="message-content">
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Actions */}
          {messages.length <= 2 && (
            <div className="quick-suggestions">
              {quickActions.map((action, idx) => (
                <button
                  key={idx}
                  className="suggestion-btn"
                  onClick={() => handleQuickAction(action.query)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="chatbot-input">
            <input
              ref={inputRef}
              type="text"
              placeholder="Ask me anything..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={isTyping}
            />
            <button 
              className="send-btn" 
              onClick={handleSend}
              disabled={!inputValue.trim() || isTyping}
            >
              <Send width={20} height={20} />
            </button>
          </div>

          {/* Footer */}
          <div className="chatbot-footer">
            <small>Ask about leads, deals, activities, or type "help" for options</small>
          </div>
        </div>
      )}
    </>
  );
}
