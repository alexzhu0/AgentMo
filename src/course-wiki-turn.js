function fail(code='COURSE_WIKI_REQUEST_INVALID'){
  throw Object.assign(new Error('Course Wiki request is invalid.'),{code});
}

export function courseMessageText(message){
  if(!message||typeof message!=='object'||!['system','user','assistant'].includes(message.role))fail();
  if(typeof message.content==='string')return message.content;
  if(!Array.isArray(message.content)||!message.content.length||message.content.some(part=>!part||part.type!=='text'||typeof part.text!=='string'||Object.keys(part).some(key=>!['type','text'].includes(key))))fail();
  return message.content.map(part=>part.text).join('\n');
}

export function projectCourseTurn(messages){
  if(!Array.isArray(messages)||!messages.length||messages.length>32)fail();
  const checked=messages.map(message=>({role:message?.role,text:courseMessageText(message)}));
  let currentIndex=-1;
  for(let index=checked.length-1;index>=0;index--){
    if(checked[index].role==='user'&&checked[index].text.trim()){
      currentIndex=index;
      break;
    }
  }
  if(currentIndex<0)fail();
  const projection={
    currentUserText:checked[currentIndex].text,
    historicalReference:checked.slice(0,currentIndex).filter(message=>message.role==='user'||message.role==='assistant'),
  };
  if(Buffer.byteLength(JSON.stringify(projection),'utf8')>48*1024)fail('COURSE_WIKI_REQUEST_TOO_LARGE');
  return projection;
}
