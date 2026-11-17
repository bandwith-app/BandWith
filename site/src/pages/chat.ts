import { runChannelPage } from './channel';
import '../styles/demos/chat.css';
import { initChatDemo } from '../ui/demos/chat';

runChannelPage(({ reduce }) => initChatDemo(document.querySelector('[data-cd-demo]'), reduce));
