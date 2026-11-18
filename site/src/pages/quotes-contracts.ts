import { runChannelPage } from './channel';
import '../styles/demos/quotes-contracts.css';
import { initQuotesDemo } from '../ui/demos/quotes-contracts';

runChannelPage(({ reduce }) => initQuotesDemo(document.querySelector('[data-qd-demo]'), reduce));
