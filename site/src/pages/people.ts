import { runChannelPage } from './channel';
import '../styles/demos/people.css';
import { initPeopleDemo } from '../ui/demos/people';

runChannelPage(({ reduce }) => initPeopleDemo(document.querySelector('[data-people-demo]'), reduce));
