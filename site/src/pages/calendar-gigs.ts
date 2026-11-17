import { runChannelPage } from './channel';
import '../styles/demos/calendar-gigs.css';
import { initCalendarGigsDemo } from '../ui/demos/calendar-gigs';

runChannelPage(({ reduce }) => initCalendarGigsDemo(document.querySelector('[data-cg-demo]'), reduce));
