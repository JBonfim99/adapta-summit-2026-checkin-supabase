import { useFormContext } from 'react-hook-form'
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface FormInputProps {
  name: string
  label: string
  placeholder?: string
  type?: 'text' | 'email' | 'textarea' | 'select'
  options?: string[]
  mask?: 'cpf' | 'phone'
}

export function FormInput({
  name,
  label,
  placeholder,
  type = 'text',
  options,
  mask,
}: FormInputProps) {
  const { control } = useFormContext()

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel className="text-foreground">{label}</FormLabel>
          <FormControl>
            {type === 'textarea' ? (
              <Textarea placeholder={placeholder} className="resize-none" {...field} />
            ) : type === 'select' ? (
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder={placeholder} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {options?.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                type={type}
                placeholder={placeholder}
                className="bg-white"
                {...field}
                onChange={(e) => {
                  let val = e.target.value
                  if (mask === 'cpf') {
                    val = val
                      .replace(/\D/g, '')
                      .replace(/(\d{3})(\d)/, '$1.$2')
                      .replace(/(\d{3})(\d)/, '$1.$2')
                      .replace(/(\d{3})(\d{1,2})/, '$1-$2')
                      .replace(/(-\d{2})\d+?$/, '$1')
                  } else if (mask === 'phone') {
                    val = val.replace(/\D/g, '')
                    if (val.length <= 10) {
                      val = val
                        .replace(/^(\d{2})(\d)/g, '($1) $2')
                        .replace(/(\d{4})(\d{1,4})$/, '$1-$2')
                    } else {
                      val = val
                        .replace(/^(\d{2})(\d)/g, '($1) $2')
                        .replace(/(\d{5})(\d{1,4})$/, '$1-$2')
                    }
                    val = val.substring(0, 15)
                  }
                  field.onChange(val)
                }}
              />
            )}
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
