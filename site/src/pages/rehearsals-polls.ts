import { runChannelPage } from './channel';
import '../styles/demos/rehearsals-polls.css';
import { initRehearsalsPollsDemo } from '../ui/demos/rehearsals-polls';

runChannelPage(({ reduce }) => initRehearsalsPollsDemo(document.querySelector('[data-rp-demo]'), reduce));
