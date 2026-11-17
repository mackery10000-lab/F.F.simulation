"""Server-side PleumRouter transport and the legacy AI boundary contract.

No inference defaults, SDK dependency, automatic model fallback or secret logging.
The application prompts, JSON contracts and retrieval algorithms live elsewhere.
"""
from __future__ import annotations
import copy
import hashlib
import json
import math
import os
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def settings():
    values = {}
    path = ROOT / '.env'
    if path.is_file():
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if line.startswith('export '):
                line = line[7:].lstrip()
            key, sep, value = line.partition('=')
            if not sep or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',key.strip()):
                continue
            value = value.strip()
            if value.startswith(('"', "'")):
                quote = value[0]
                end = value.find(quote,1)
                if end < 0:
                    raise ValueError('잘못된 .env 인용부호: '+key.strip())
                value = value[1:end]
            else:
                value = re.split(r'\s+#',value,maxsplit=1)[0].rstrip()
            values[key.strip()] = value
    values.update(os.environ)
    return values


def validate_base(base):
    # The configured value is used for every request; this is an allowlist,
    # never a default URL or a fallback to OpenAI's own service.
    if base.rstrip('/') != 'https://apirouter.pleum.ai/v1':
        raise ValueError('OPENAI_BASE_URL은 지정된 PleumRouter /v1 주소여야 합니다.')
    return base.rstrip('/')


class ProviderError(RuntimeError):
    def __init__(self, kind, message, attempts=0, elapsed_seconds=0):
        super().__init__(message)
        self.kind,self.attempts,self.elapsed_seconds=kind,attempts,elapsed_seconds


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        raise ProviderError('CONNECTION_ERROR','PleumRouter 리디렉션을 거부했습니다.')


def wire_schema(schema):
    """Strict wire representation; never mutate the application's schema."""
    schema=copy.deepcopy(schema)
    def visit(node):
        if isinstance(node,dict):
            node.pop('default',None)
            if node.get('type')=='object' and 'properties' in node:
                node['required']=list(node['properties'])
                node['additionalProperties']=False
            for value in list(node.values()):visit(value)
        elif isinstance(node,list):
            for value in node:visit(value)
    visit(schema)
    return schema


class PleumTransport:
    def __init__(self,base=None,model=None,embedding_model=None,timeout=120,retries=1):
        values=settings()
        self.base=validate_base(base if base is not None else values.get('OPENAI_BASE_URL',''))
        configured=values.get('OPENAI_MODEL','')
        self.model=model if model is not None else configured
        if not configured or self.model!=configured:
            raise ValueError('모델은 .env의 OPENAI_MODEL과 일치해야 합니다. 자동 대체하지 않습니다.')
        self.key=values.get('OPENAI_API_KEY','')
        self.effort=values.get('OPENAI_REASONING_EFFORT','')
        if self.effort not in ('none','minimal','low','medium','high','xhigh','max'):
            raise ValueError('OPENAI_REASONING_EFFORT가 없거나 올바르지 않습니다.')
        self.embedding_model=embedding_model if embedding_model is not None else values.get('OPENAI_EMBEDDING_MODEL','')
        if not math.isfinite(timeout) or not 0<timeout<=120 or type(retries) is not int or not 0<=retries<=2:
            raise ValueError('Timeout must be (0,120] seconds; retries must be 0..2')
        self.timeout,self.retries=timeout,retries
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
        self.catalog=None
        self.authenticated=False
        self.embedding_verified=False

    def request(self,path,payload=None,timeout=None):
        if not self.key or not self.key.isascii() or any(c.isspace() for c in self.key):
            raise ProviderError('AUTHENTICATION_ERROR','OPENAI_API_KEY에 발급받은 PleumRouter 키를 설정하세요.')
        if path not in ('/models','/credits','/chat/completions','/embeddings'):
            raise ProviderError('CONNECTION_ERROR','허용되지 않은 AI endpoint입니다.')
        started=time.perf_counter()
        for attempt in range(self.retries+1):
            try:
                body=None if payload is None else json.dumps(payload,ensure_ascii=False,allow_nan=False).encode('utf-8')
                req=urllib.request.Request(self.base+path,data=body,headers={'Authorization':'Bearer '+self.key,'Content-Type':'application/json'})
                with self.opener.open(req,timeout=timeout or self.timeout) as response:
                    raw=response.read(2_000_001)
                if len(raw)>2_000_000:
                    raise ProviderError('MODEL_OUTPUT_ERROR','AI 응답 크기가 제한을 초과했습니다.')
                value=json.loads(raw)
                if not isinstance(value,dict) or value.get('error'):
                    raise ProviderError('MODEL_OUTPUT_ERROR','PleumRouter 응답 형식이 올바르지 않습니다.')
                if path!='/models':
                    self.authenticated=True
                return value,{'attempts':attempt+1,'elapsed_seconds':time.perf_counter()-started}
            except urllib.error.HTTPError as error:
                messages={400:'요청 파라미터·JSON Schema·추론 수준 호환성을 확인하세요.',401:'API 키 인증 실패',402:'PleumRouter 크레딧 부족',403:'모델 접근 권한 없음',404:'지정 모델 또는 endpoint 없음',429:'요청 한도 초과'}
                failure=ProviderError('RATE_LIMIT' if error.code==429 else 'PROVIDER_HTTP_ERROR',
                    f'PleumRouter HTTP {error.code}: '+messages.get(error.code,'제공자 요청 실패'))
                if error.code==400:
                    try:
                        rejected=json.loads(error.read(16000))
                        detail=str(rejected.get('error',{}).get('message',''))
                        if '허용 모델' in detail or 'allowed model' in detail.lower():
                            failure=ProviderError('MODEL_ACCESS_ERROR','PleumRouter API 키의 허용 모델 설정에서 요청 모델을 활성화하세요.')
                    except (ValueError,AttributeError,TypeError):
                        pass
                # POST inference is not retried after ambiguous timeouts/5xx:
                # it could already have been billed. Only an explicit 429 is retried.
                retry=error.code==429 or (payload is None and error.code>=500)
            except (urllib.error.URLError,TimeoutError,socket.timeout,OSError):
                failure=ProviderError('CONNECTION_ERROR','PleumRouter 연결 실패 또는 시간 초과')
                retry=payload is None
            except (ValueError,UnicodeError):
                failure=ProviderError('MODEL_OUTPUT_ERROR','AI 응답을 JSON으로 해석할 수 없습니다.')
                retry=False
            except ProviderError as error:
                failure=error;retry=False
            if not retry or attempt>=self.retries:
                failure.attempts=attempt+1;failure.elapsed_seconds=time.perf_counter()-started
                raise failure from None
            time.sleep(.15*(attempt+1))

    def models(self,refresh=False,timeout=None):
        if self.catalog is None or refresh:
            result,_=self.request('/models',timeout=timeout)
            rows=result.get('data')
            if not isinstance(rows,list):
                raise ProviderError('MODEL_OUTPUT_ERROR','PleumRouter 모델 목록 형식 오류')
            self.catalog=rows
        return self.catalog

    def entry(self,model,operation):
        row=next((r for r in self.models() if isinstance(r,dict) and r.get('id')==model and r.get('is_active',True)),None)
        if not row or operation not in row.get('operations',[]):
            raise ProviderError('MODEL_NOT_INSTALLED','PleumRouter 카탈로그에서 지정 모델·기능을 사용할 수 없습니다: '+model)
        return row

    def digest(self,row):
        identity={'provider':'pleumrouter','base_url':self.base,'id':row['id'],'owner':row.get('provider'),
                  'revision':row.get('revision',row.get('created')),'adapter':1,
                  'reasoning_effort':self.effort if row['id']==self.model else None}
        return 'pleumrouter:'+hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest()

    def tags(self):
        return {'models':[{'name':row['id'],'digest':self.digest(row)} for row in self.models() if isinstance(row,dict) and isinstance(row.get('id'),str)]}

    def chat(self,payload):
        if payload.get('model')!=self.model or payload.get('stream') is not False:
            raise ProviderError('MODEL_OUTPUT_ERROR','모델 변경 또는 지원하지 않는 스트림 계약을 거부했습니다.')
        row=self.entry(self.model,'chat.generate')
        required={'reasoning_effort','response_format','max_tokens'}
        if not required.issubset(set(row.get('supported_parameters',[]))):
            raise ProviderError('MODEL_OUTPUT_ERROR','지정 모델의 추론 수준·구조화 출력 지원이 확인되지 않았습니다.')
        options=payload.get('options',{})
        body={'model':self.model,'stream':False,'messages':payload['messages'],
              'reasoning_effort':self.effort,'max_tokens':options.get('num_predict',3000),
              'response_format':{'type':'json_schema','json_schema':{'name':'FightFrequencyOutput','strict':True,'schema':wire_schema(payload['format'])}}}
        for name in ('temperature','seed'):
            if name in options:
                if name not in row['supported_parameters']:
                    raise ProviderError('MODEL_OUTPUT_ERROR','지정 모델이 요청한 파라미터를 지원하지 않습니다: '+name)
                body[name]=options[name]
        result,audit=self.request('/chat/completions',body)
        try:
            choices=result['choices']
            if len(choices)!=1 or result.get('model')!=self.model:
                raise ValueError()
            choice=choices[0];message=choice['message'];content=message.get('content')
            if choice.get('finish_reason')!='stop' or message.get('refusal') or message.get('tool_calls') or not isinstance(content,str) or not content.strip():
                raise ValueError()
        except (KeyError,TypeError,ValueError):
            raise ProviderError('MODEL_OUTPUT_ERROR','AI 응답 거부·잘린 출력·빈 응답·모델 불일치를 감지했습니다.',**audit) from None
        # Normalize only the provider envelope. Business JSON is validated by
        # the original Pydantic/schema and source-evidence rules in each caller.
        usage=result.get('usage',{})
        if isinstance(usage,dict):
            audit['usage']={k:v for k,v in usage.items() if k in ('prompt_tokens','completion_tokens','total_tokens') and type(v) is int and v>=0}
        return {'model':self.model,'done':True,'done_reason':'stop','message':{'role':'assistant','content':content}},audit

    def embed(self,texts):
        if not self.embedding_model:
            raise ProviderError('MODEL_OUTPUT_ERROR','OPENAI_EMBEDDING_MODEL이 설정되지 않았습니다.')
        self.entry(self.embedding_model,'embedding.create')
        result,audit=self.request('/embeddings',{'model':self.embedding_model,'input':texts})
        try:
            rows=result['data']
            if result.get('model')!=self.embedding_model or len(rows)!=len(texts) or {r['index'] for r in rows}!=set(range(len(texts))):
                raise ValueError()
            vectors=[r['embedding'] for r in sorted(rows,key=lambda r:r['index'])]
            if not vectors or not vectors[0] or any(len(v)!=len(vectors[0]) or any(type(x) not in (int,float) or not math.isfinite(x) for x in v) for v in vectors):
                raise ValueError()
        except (KeyError,TypeError,ValueError):
            raise ProviderError('MODEL_OUTPUT_ERROR','임베딩 모델·인덱스·벡터 차원 또는 수치 검증 실패',**audit) from None
        self.embedding_verified=True
        return vectors,audit
