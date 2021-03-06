'use strict';

const path = require('path');
const config = require('config');
const log = require('log')();
const request = require('request-promise');

module.exports = function*(group) {

  let gotowebinar = group.teacher.gotowebinar;
  if (!gotowebinar) {
    throw new Error("No gotowebinar config for user:" + group.teacher.profileName);
  }


  let duration = function() {
    let s = group.timeStart.split(':');
    let e = group.timeEnd.split(':');
    return (e[0] - s[0]) * 60 + (e[1] - s[1]);
  }();

  function addDuration(date) {
    // take last date, increase by 1 months and add to the webinar
    let newDate = new Date(date);
    newDate.setMinutes(newDate.getMinutes() + duration);
    return newDate;
  }

  if (!group.webinarId) {
    log.debug("Creating the webinar");

    let options = {
      url:     `https://api.citrixonline.com/G2W/rest/organizers/${gotowebinar.organizer_key}/webinars`,
      json:    true,
      headers: {
        'Authorization': gotowebinar.access_token,
        'content-type':  'application/json; charset=utf-8'
      },
      body:    {
        subject:  group.title,
        times:    [
          {
            startTime: group.dateStart.toJSON().replace('.000', ''),
            endTime:   addDuration(group.dateStart).toJSON().replace('.000', '')
          }
        ],
        timeZone: "Europe/Moscow"
      }
    };

    let response = yield request.post(options);

    log.debug("Response ", response);

    group.webinarKey = response.webinarKey;

    let webinars = yield request({
      url:     `https://api.citrixonline.com/G2W/rest/organizers/${gotowebinar.organizer_key}/webinars/`,
      json:    true,
      headers: {
        'Authorization': gotowebinar.access_token
      }
    });

    let newWebinar = webinars.find(w => w.webinarKey == group.webinarKey);
    group.webinarId = newWebinar.webinarID;

    log.debug("Created", newWebinar);
    yield group.persist();
  }


  let dates = group.getAllDates();

  log.debug("Adding the dates", dates);

  let times = dates.map(date => ({
    startTime: date.toJSON().replace('.000', ''),
    endTime:   addDuration(date).toJSON().replace('.000', '')
  }));

  // take last date, increase by 1 months and add to the webinar
  let extraEndDate = new Date(group.dateEnd);
  extraEndDate.setMonth(extraEndDate.getMonth() + 1);
  let extraEndDateTo = new Date(+extraEndDate + duration * 60 * 1000);

  times.push({
    startTime: extraEndDate.toJSON().replace('.000', ''),
    endTime:   extraEndDateTo.toJSON().replace('.000', '')
  });

  let responsePut = yield request({
    method:  'PUT',
    url:     `https://api.citrixonline.com/G2W/rest/organizers/${gotowebinar.organizer_key}/webinars/${group.webinarKey}`,
    json:    true,
    headers: {
      'Authorization': gotowebinar.access_token,
      'content-type':  'application/json; charset=utf-8'
    },
    body:    {
      times:    times,
      timeZone: "Europe/Moscow"
    }
  });

  log.debug("Added dates", responsePut);

};
